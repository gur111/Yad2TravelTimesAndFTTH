# Yad2 Travel Times and FTTH
Automatically displays additional address information on Yad2 rental listings and travel times to Herzliya O2 Apple Office.

## Requirements
1. Google Maps API key (Distances Matrix API)
1. A server to run server.py on
1. An SSL certificate for the server (or it wouldn't work on HTTPS websites)
1. Domain I guess so SSL would work

## Setup
1. Clone the repo on the server
1. In the repo, add a `.key` file with the Maps API key (just the key, nothing else)
1. Point your domain to the server
1. Setup SSL on the machine (e.g. Let's Encrypt + certbot)
1. Change the domain in the content.js from the ...gtelem.com to your own.
1. Go to chrome's extensions menu and click "load unpacked".
Have fun.