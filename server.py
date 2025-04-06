from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import time
import requests
import sqlite3
from hashlib import sha256

DB_PATH = "travel_cache.db"
app = Flask(__name__)
CORS(app)

FTTH_API_URL = "https://www.bezeq.co.il/umbraco/api/FormWebApi/CheckAddress"
GOOGLE_MAPS_API_URL = "https://maps.googleapis.com/maps/api/distancematrix/json"

office_address = {"city": "הרצליה", "street": "משכית", "houseNum": "12"}


def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS travel_cache (
            id TEXT PRIMARY KEY,
            origin TEXT,
            destination TEXT,
            mode TEXT,
            distance TEXT,
            duration TEXT
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS ftth_cache (
            id TEXT PRIMARY KEY,
            data TEXT,
            timestamp INTEGER
        )
    ''')

    conn.commit()
    conn.close()


def generate_ftth_cache_key(city, street, house_num):
    key_string = f"{city}|{street}|{house_num}"
    return sha256(key_string.encode()).hexdigest()


def get_cached_ftth(city, street, house_num, ttl_ms):
    key = generate_ftth_cache_key(city, street, house_num)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT data, timestamp FROM ftth_cache WHERE id=?", (key,))
    row = c.fetchone()
    conn.close()
    if row:
        if (int(time.time() * 1000) - row[1]) < ttl_ms:
            return json.loads(row[0])
    return None


def cache_ftth_result(city, street, house_num, result):
    key = generate_ftth_cache_key(city, street, house_num)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO ftth_cache VALUES (?, ?, ?)", (
        key,
        json.dumps(result),
        int(time.time() * 1000)
    ))
    conn.commit()
    conn.close()


def generate_travel_cache_key(origin, destination, mode):
    key_string = f"{origin['city']}-{origin['street']}-{origin['houseNum']}|{destination['city']}-{destination['street']}-{destination['houseNum']}|{mode}"
    return sha256(key_string.encode()).hexdigest()


def get_cached_travel_time(origin, destination, mode):
    key = generate_travel_cache_key(origin, destination, mode)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT distance, duration FROM travel_cache WHERE id=?", (key,))
    row = c.fetchone()
    conn.close()
    if row:
        return {"distance": row[0], "duration": row[1]}
    return None


def cache_travel_time(origin, destination, mode, distance, duration):
    key = generate_travel_cache_key(origin, destination, mode)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO travel_cache VALUES (?, ?, ?, ?, ?, ?)", (
        key,
        f"{origin['street']} {origin['houseNum']}, {origin['city']}",
        f"{destination['street']} {destination['houseNum']}, {destination['city']}",
        mode,
        distance,
        duration
    ))
    conn.commit()
    conn.close()


def load_api_key():
    try:
        with open('.key', 'r') as f:
            return f.read().strip()
    except FileNotFoundError:
        print("API key file '.key' not found.")
        return None


def check_ftth_availability(city, street, house_num):
    TTL_MS = 14 * 24 * 60 * 60 * 1000  # 14 days

    # Try cache first
    cached = get_cached_ftth(city, street, house_num, TTL_MS)
    if cached:
        print(f"Using cached FTTH result for {street} {house_num}, {city}")
        return cached

    # Not cached — call API
    payload = {"House": house_num, "Street": street,
               "City": city, "Entrance": ""}
    response = requests.post(FTTH_API_URL, json=payload)
    if response.status_code == 200:
        data = response.json()
        status_mapping = {
            1: "available",
            3: "unavailable"
        }
        status = status_mapping.get(
            data.get("Status"), f"unknown {data.get('Status')}")
        result = {
            "Status": status,
            "CityId": data.get("CityId"),
            "StreetId": data.get("StreetId"),
            "ErrorCode": data.get("ErrorCode"),
            "ErrorMessage": data.get("ErrorMessage"),
            "IsSuccessful": data.get("IsSuccessful")
        }

        cache_ftth_result(city, street, house_num, result)
        return result
    else:
        return None


# Function to get travel time (duration and distance) from Google Maps API for a specific mode
def get_travel_time(origin_data, destination_data, mode, api_key):
    # Check cache first
    cached = get_cached_travel_time(origin_data, destination_data, mode)
    if cached:
        print(
            f"Using cache for {mode} from {origin_data} -> {destination_data}")
        return cached

    # Not cached, call API
    origin = f"{origin_data['street']} {origin_data['houseNum']}, {origin_data['city']}"
    destination = f"{destination_data['street']} {destination_data['houseNum']}, {destination_data['city']}"
    params = {
        "origins": origin,
        "destinations": destination,
        "mode": mode,
        "key": api_key
    }

    response = requests.get(GOOGLE_MAPS_API_URL, params=params)
    if response.status_code != 200:
        print(f"Error with request: {response.status_code}")
        return None

    data = response.json()
    if data["status"] != "OK":
        print(f"Error from API: {data['status']}")
        return None

    try:
        distance = data["rows"][0]["elements"][0]["distance"]["text"]
        duration = data["rows"][0]["elements"][0]["duration"]["text"]

        # Save to cache
        cache_travel_time(origin_data, destination_data,
                          mode, distance, duration)

        return {"distance": distance, "duration": duration}
    except KeyError:
        print("Error parsing response data.")
        return None

# Function to get travel times for both walking and driving modes


def get_travel_times(origin, destination):
    api_key = load_api_key()
    if not api_key:
        return None

    travel_times = {}

    # Walking request
    walking_data = get_travel_time(origin, destination, "walking", api_key)
    if walking_data:
        travel_times["walking"] = walking_data

    # Driving request
    driving_data = get_travel_time(origin, destination, "driving", api_key)
    if driving_data:
        travel_times["driving"] = driving_data

    # Biking request
    bicycling_data = get_travel_time(origin, destination, "bicycling", api_key)
    if bicycling_data:
        travel_times["biking"] = bicycling_data

    return travel_times


@app.route("/process_address", methods=["POST"])
def process_address():
    data = request.json
    if not data or "city" not in data or "street" not in data or "houseNum" not in data:
        return jsonify({"error": "Invalid address data"}), 400

    ftth_result = check_ftth_availability(
        data["city"], data["street"], data["houseNum"])
    travel_times = get_travel_times(data, office_address)

    return jsonify({"ftth": ftth_result, "travel_times": travel_times})


if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=8000, debug=True)
