// Set the debug flag (set to true for verbose logging)
const debug = true;

// Centralized log function
function log(level, message) {
    if (level === 'verbose' && !debug) {
        return; // Skip verbose logging if debug is off
    }

    // Always log errors to the console
    if (level === 'error') {
        console.error(`[YADZ] Error: ${message}`);
        return;
    }

    // Get the stack trace to extract file name and line number
    const stack = new Error().stack;
    const callerLine = stack.split("\n")[2]?.trim();

    // Extract file name from the line
    const fileNameMatch = callerLine?.match(/([a-zA-Z0-9_-]+\.js):(\d+):/);
    const fileName = fileNameMatch ? fileNameMatch[1] : "Unknown file";

    console.log(`[YADZ] ${level}: ${message} (at ${fileName})`);
}
// Wait for the page to be fully loaded and give time for any dynamic content
log('verbose', "Yads Extension for extracting addresses");
initializeAddressExtraction();
document.addEventListener("DOMContentLoaded", function () {
    // log('verbose', "Yads Extension for extracting addresses");
});

// Main function to process addresses on the page
function processAddresses() {
    log('verbose', "Finding addresses");
    const addresses = extractAddressFromPage();

    if (addresses && addresses.length > 0) {
        log('verbose', `Found ${addresses.length} addresses to process`);

        // Process each address
        addresses.forEach(address => {
            if (address.city && address.street && address.houseNum) {
                // Show loading indicator before sending to server
                appendLoadingIndicator(address.parentElement, address);

                sendAddressToServer(address).then(result => {
                    if (result) {
                        log('verbose', `Processed data for ${address.street} ${address.houseNum}: ${JSON.stringify(result)}`);
                    }
                });
            } else {
                log('verbose', `Incomplete address data: ${JSON.stringify(address)}`);
            }
        });
    } else {
        log('verbose', "No addresses found on the page at this time.");
    }
}

function appendLoadingIndicator(parentElement, address) {
    // Generate a consistent hash based on address components
    const addressHash = generateAddressHash(address);
    const uniqueId = `addr_info_${addressHash}`;

    let resultsDiv = document.getElementById(uniqueId);
    if (!resultsDiv) {
        resultsDiv = document.createElement("div");
        resultsDiv.id = uniqueId;
        resultsDiv.style.marginTop = "5px";
        resultsDiv.style.fontSize = "14px";
        resultsDiv.style.fontWeight = "normal";
        resultsDiv.style.color = "#333";
        resultsDiv.style.background = "#f8f8f8";
        resultsDiv.style.padding = "5px";
        resultsDiv.style.borderRadius = "4px";
        resultsDiv.innerHTML = "Loading information..."; // Loading message
        parentElement.insertAdjacentElement("afterend", resultsDiv);
    }
}

// Add a mutation observer to handle dynamically loaded content
function initializeAddressExtraction() {
    log("info", "Yad2 Address Info Extension initialized");

    // Check if the DOM is already loaded
    if (document.readyState === "loading") {
        // If the DOM is still loading, add an event listener
        document.addEventListener("DOMContentLoaded", processAddresses);
    } else {
        // If the DOM is already loaded, run the code immediately
        processAddresses();
    }

    // Set up an observer to detect new content
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                // Wait a moment for the content to fully render
                setTimeout(processAddresses, 500);
                break;
            }
        }
    });

    // Start observing the document body for changes
    observer.observe(document.body, { childList: true, subtree: true });

    // Also check periodically for new listings that might have been missed
    setInterval(processAddresses, 5000);
}

function generateAddressHash(address) {
    // Normalize address components to lowercase and trim whitespace
    const street = (address.street || "").toLowerCase().trim();
    const houseNum = (address.houseNum || "").toLowerCase().trim();
    const city = (address.city || "").toLowerCase().trim();

    // Combine components and create a simple hash
    const addressString = `${street}_${houseNum}_${city}`;

    // Create a numeric hash (simple but effective for this use case)
    let hash = 0;
    for (let i = 0; i < addressString.length; i++) {
        const char = addressString.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }

    // Convert to a string and ensure it's positive by using absolute value
    return Math.abs(hash).toString(36);
}

function extractAddressFromPage() {
    log('verbose', "Extracting address(es)");
    const url = window.location.href;
    if (url.startsWith("https://www.yad2.co.il/realestate/item")) {
        log('verbose', "Extracting single address")
        // Try the single address case first
        const h1Element = document.querySelector("h1[class^='heading_heading_']");
        const h2Element = document.querySelector("h2[class^='address_address']");

        if (h1Element && h2Element) {
            const addressParts = h1Element.textContent.trim().split(" ");
            const houseNum = addressParts.pop(); // Last part is the house number
            const street = addressParts.join(" "); // Remaining is the street name

            const cityParts = h2Element.textContent.trim().split(", ");
            const city = cityParts.pop(); // Last part is the city name

            return [{ city, street, houseNum, parentElement: h1Element }];
        }

        log('verbose', "No single address found on the page at this time.");
        return null;
    } else if (url.startsWith("https://www.yad2.co.il/realestate/rent")) {
        log('verbose', "Extracting multiple addresses")
        // If single address not found, try to find multiple addresses
        const addressHeadings = document.querySelectorAll("span[class^='item-data-content_heading__']");
        if (addressHeadings && addressHeadings.length > 0) {
            const addresses = [];

            addressHeadings.forEach(heading => {
                const addressText = heading.textContent.trim();
                const addressParts = addressText.split(" ");
                const houseNum = addressParts.pop(); // Last part is house number
                const street = addressParts.join(" "); // Remaining is street name

                // Find the closest city element - should be a sibling or nearby element
                const parentContainer = heading.parentElement.parentElement;
                const cityElement = parentContainer?.querySelector("span[class^='item-data-content_itemInfoLine__']");

                if (cityElement) {
                    const cityText = cityElement.textContent.trim();
                    const cityParts = cityText.split(", ");
                    const city = cityParts.pop(); // Last part is city

                    addresses.push({ city, street, houseNum, parentElement: heading });
                }
            });

            if (addresses.length > 0) {
                return addresses;
            }
        }
        log('verbose', "No addresses found on the page at this time.");
        return null;
    }
    log('verbose', "Not a supported page for extracting addresses")
    return null;
}

async function sendAddressToServer(address) {
    const addressHash = generateAddressHash(address);
    const uniqueId = `addr_info_${addressHash}`;
    const ttlMs = 7 * 24 * 60 * 60 * 1000; // 7 days

    const cachedRaw = localStorage.getItem(uniqueId);
    if (cachedRaw) {
        try {
            const { data, timestamp } = JSON.parse(cachedRaw);
            const isFresh = Date.now() - timestamp < ttlMs;
            const hasFTTH = data && data.ftth && data.ftth.IsSuccessful;

            if (isFresh && hasFTTH) {
                log('verbose', `Using cached data for ${address.street} ${address.houseNum}`);
                appendResultsToPage(address.parentElement, data, address);
                return data;
            } else {
                localStorage.removeItem(uniqueId); // Expired or incomplete
            }
        } catch (e) {
            log('error', `Cache parse error: ${e.message}`);
            localStorage.removeItem(uniqueId);
        }
    }

    // Fetch from server
    const url = "https://gcp.gtelem.com/process_address";
    const address_only = { city: address.city, street: address.street, houseNum: address.houseNum };

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(address_only)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();
        log('verbose', `Server response: ${JSON.stringify(data)}`);

        // Cache result
        localStorage.setItem(uniqueId, JSON.stringify({
            data,
            timestamp: Date.now()
        }));

        appendResultsToPage(address.parentElement, data, address);
        return data;
    } catch (error) {
        log('error', `Error sending address to server: ${error.message}`);
        return null;
    }
}

function appendResultsToPage(parentElement, data, address) {
    // Generate a consistent hash based on address components
    const addressHash = generateAddressHash(address);
    const uniqueId = `addr_info_${addressHash}`;

    let resultsDiv = document.getElementById(uniqueId);
    if (!resultsDiv) {
        resultsDiv = document.createElement("div");
        resultsDiv.id = uniqueId;
        resultsDiv.style.marginTop = "5px";
        resultsDiv.style.fontSize = "14px";
        resultsDiv.style.fontWeight = "normal";
        resultsDiv.style.color = "#333";
        resultsDiv.style.background = "#f8f8f8";
        resultsDiv.style.padding = "5px";
        resultsDiv.style.borderRadius = "4px";
        parentElement.insertAdjacentElement("afterend", resultsDiv);
    } else {
        resultsDiv.innerHTML = "";
    }

    if (data.travel_times) {
        if (data.travel_times.walking) {
            resultsDiv.innerHTML += `🚶 ${data.travel_times.walking.duration}<br>`;
        }
        if (data.travel_times.biking) {
            resultsDiv.innerHTML += `🚴 ${data.travel_times.biking.duration}<br>`;
        }
    }

    if (data.ftth && data.ftth.IsSuccessful && data.ftth.Status) {
        resultsDiv.innerHTML += data.ftth.Status === "available" ? "🛜" : "📵";
    }
}
