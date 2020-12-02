const int pinCount = 2;
const int pins[] = {12, 14};
bool pinStates[] = {false, false};

// Load Wi-Fi library
#include <ESP8266WiFi.h>

// Replace with your network credentials
const char* ssid     = "Simplintho";
const char* password = "windycindy@42";

// Set web server port number to 80
WiFiServer server(80);

// Set your Static IP address
// IPAddress local_IP(192, 168, 0, 164);
// Set your Gateway IP address
// IPAddress gateway(192, 168, 0, 1);

// IPAddress subnet(255, 255, 255, 0);

// Variable to store the HTTP request
String header;

// Current time
unsigned long currentTime = millis();
// Previous time
unsigned long previousTime = 0; 
// Define timeout time in milliseconds (example: 2000ms = 2s)
const long timeoutTime = 2000;

void setup(){
  Serial.begin(9600);
  Serial.println("Startup!");

  // Set pinmode to output for onboard LED and write HIGH
  pinMode(D0, OUTPUT);
  digitalWrite(D0, LOW);
  
  for(int i = 0; i < pinCount; i++) {
    pinMode(pins[i], OUTPUT);
    digitalWrite(pins[i], HIGH);
  }

  // Configures static IP address
  // if (!WiFi.config(local_IP, gateway, subnet)) {
  //   Serial.println("STA Failed to configure");
  // }
    
  // Connect to Wi-Fi network with SSID and password
  Serial.print("Connecting to ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  // Print local IP address and start web server
  Serial.println("");
  Serial.println("WiFi connected.");
  Serial.println("IP address: ");
  Serial.println(WiFi.localIP());
  server.begin();

  // Write low to onboard LED to signal END BOOT
  digitalWrite(D0, HIGH);
}

void loop(){
  // Listen for incoming clients
  WiFiClient client = server.available();

  if (client) {
    Serial.println("New Client.");
    // make a String to hold incoming data from the client
    String currentLine = "";
    currentTime = millis();
    previousTime = currentTime;
    // loop while the client's connected
    while (client.connected() && currentTime - previousTime <= timeoutTime) {
      currentTime = millis();         
      if (client.available()) {
        char c = client.read();
        Serial.write(c);
        header += c;
        if (c == '\n') {
          // if the current line is blank, you got two newline characters in a row.
          // that's the end of the client HTTP request, so send a response:
          if (currentLine.length() == 0) {
            // HTTP headers always start with a response code (e.g. HTTP/1.1 200 OK)
            // and a content-type so the client knows what's coming, then a blank line:
            client.println("HTTP/1.1 200 OK");
            client.println("Content-type:application/json");
            client.println("Connection: close");
            client.println();
            
            // turns the GPIOs on and off
            if (header.indexOf("GET /state") >= 0) {
              String response = "{\"status\": [";
              if (pinStates[0] == true) {
                response = response + "true,";
              } else {
                response = response + "false,";
              }
              if (pinStates[1] == true) {
                response = response + "true";
              } else {
                response = response + "false";
              }
                response = response + "]}";
              client.println(response);
            } else if (header.indexOf("GET /1/on") >= 0) {
              Serial.println("GPIO 1 on");
              pinStates[0] = true;
              digitalWrite(pins[0], LOW);
              client.println("{\"status\":true}");
            } else if (header.indexOf("GET /1/off") >= 0) {
              Serial.println("GPIO 1 off");
              pinStates[0] = false;
              digitalWrite(pins[0], HIGH);
              client.println("{\"status\":false}");
            } else if (header.indexOf("GET /1/state") >= 0) {
              if (pinStates[0] == true) {
                client.println("{\"status\":true}");
              } else {
                client.println("{\"status\":false}");
              }
            } else if (header.indexOf("GET /2/on") >= 0) {
              Serial.println("GPIO 2 on");
              pinStates[1] = true;
              digitalWrite(pins[1], LOW);
              client.println("{\"status\":true}");
            } else if (header.indexOf("GET /2/off") >= 0) {
              Serial.println("GPIO 2 off");
              pinStates[1] = false;
              digitalWrite(pins[1], HIGH);
              client.println("{\"status\":false}");
            } else if (header.indexOf("GET /2/state") >= 0) {
              if (pinStates[1] == true) {
                client.println("{\"status\":true}");
              } else {
                client.println("{\"status\":false}");
              }
            } else {
              client.println("{\"error\":\"Method Not Found\"}");
            }
            
            // The HTTP response ends with another blank line
            client.println();
            // Break out of the while loop
            break;
          } else { // if you got a newline, then clear currentLine
            currentLine = "";
          }
        } else if (c != '\r') {  // if you got anything else but a carriage return character,
          currentLine += c;      // add it to the end of the currentLine
        }
      }
    }
    // Clear the header variable
    header = "";
    // Close the connection
    client.stop();
    Serial.println("Client disconnected.");
    Serial.println("");
  }
}
