/* Arduino 'slimme meter' P1-port reader.
 serial poort gebruiken pin 0)
 https://github.com/matthijskooijman/arduino-dsmr
*/

//#include <AltSoftSerial.h>
#include <SPI.h>
#include <Ethernet.h>
byte mac[] = {
  0x00,0x40,0xad,0x95,0x4f,0x34};
//  0xDE, 0xAD, 0xBE, 0x30, 0x32, 0x31};
IPAddress ip(192,168,254,15);
IPAddress server(192,168,254,11);
EthernetClient client;
const int requestPin =  5;
char input; // incoming serial data (byte)
bool readnextLine = false;
#define BUFSIZE 75
char buffer[BUFSIZE]; //Buffer for serial data to find \n .
int bufpos = 0;
long mEVLT = 0; //Meter reading Electrics - consumption low tariff
long mEVHT = 0; //Meter reading Electrics - consumption high tariff
long mEAV = 0;  //Meter reading Electrics - Actual consumption
long mG = 0;    //Meter reading Gas
long TmEVLT =0;
long TmEVHT =0;
long TmEAV =0;

long PmEVLT = 1; //Meter reading Electrics - consumption low tariff
long PmEVHT = 1; //Meter reading Electrics - consumption high tariff
long PmEAV = 1;  //Meter reading Electrics - Actual consumption
long PmG = 1;    //Meter reading Gas
long PTmEVLT =1;
long PTmEVHT =1;
long PTmEAV =1;

long lastTime = 0;               // will store last time
long interval = 60000*5;         // (60000 = minuut * aantal / interval at which to blink (milliseconds)
//long interval = 10000;

void setup() {
  Serial.begin(115200);
  delay(1000);
//   Ethernet.begin(mac, ip);
//   delay(1000);
  decodeTelegram();

  Serial.print("mEVLT Laag tarief : ");
  Serial.print(mEVLT);
  Serial.println(" Watt");

  Serial.print("mEVHT Hoog tarief: ");
  Serial.print(mEVHT);
  Serial.println(" Watt");

  Serial.print("TmEVLT zonnepaneel Laag tarief : ");
  Serial.print(TmEVLT);
  Serial.println(" Watt");

  Serial.print("TmEVHT Zonnepaneel Hoog tarief: ");
  Serial.print(TmEVHT);
  Serial.println(" Watt");

  Serial.print("mEAV Actueel : ");
  Serial.print(mEAV);
  Serial.println(" Watt");

  Serial.print("TmEAV Zonnepaneel Actueel : ");
  Serial.print(TmEAV);
  Serial.println(" Watt");

  Serial.print("Gas : ");
  Serial.print(mG);
  Serial.println(" m2");

}

void loop() {
    decodeTelegram();
                      // controleer of er 0 waarden zijn geraporteerd. Zoja, dan is de vorige waarde geldig
//    if(mEVLT>0){
      PmEVLT=mEVLT;
//    }
//        if(mEVHT>0){
      PmEVHT=mEVHT;
//    }
//        if(TmEVLT>0){
      PTmEVLT=TmEVLT;
//    }
//        if(TmEVHT>0){
      PTmEVHT=TmEVHT;
//    }
//        if(mEAV>0){
      PmEAV=mEAV;
//    }
//        if(TmEAV>0){
      PTmEAV=TmEAV;
//   }
//       if(mG>0){
      PmG=mG;
//    }

                            // zend na de intervaltijd de gegevens naar de RPi
  if(millis() - lastTime > interval) {
    lastTime = millis();
    //send data to PHP/MySQL
    // httpRequest();
    //Stop Ethernet
    // client.stop();
  }
} //Einde loop

void decodeTelegram() {
//  Serial.println("Open telegram p1 poort");
  long tl = 0;
  long tld =0;

  if (Serial.available()) {
    input = Serial.read();
    char inChar = (char)input;
    // Fill buffer up to and including a new line (\n)
    buffer[bufpos] = input&127;
    bufpos++;

    if (input == '\n') { // We received a new line (data up to \n)
      if (sscanf(buffer,"1-0:1.8.1(%ld.%ld" ,&tl, &tld)==2){
        tl *= 1000;
        tl += tld;
        mEVLT = tl;
//    Serial.print("mEVLT Laag tarief : ");
//    Serial.print(mEVLT);
//    Serial.println(" Watt");
      }

      // 1-0:1.8.2 = Elektra verbruik hoog tarief (DSMR v4.0)
      if (sscanf(buffer,"1-0:1.8.2(%ld.%ld" ,&tl, &tld)==2){
//      Serial.println("mEVHT gevonden");
        tl *= 1000;
        tl += tld;
        mEVHT = tl;
//    Serial.print("mEVHT Hoog tarief: ");
//    Serial.print(mEVHT);
//    Serial.println(" Watt");
      }

      // 1-0:2.8.1 = Elektra verbruik laag tarief (DSMR v4.0)
      if (sscanf(buffer,"1-0:2.8.1(%ld.%ld" ,&tl, &tld)==2){
        tl *= 1000;
        tl += tld;
        TmEVLT = tl;
//    Serial.print("TmEVLT zonnepaneel Laag tarief : ");
//    Serial.print(TmEVLT);
//    Serial.println(" Watt");
      }

      // 1-0:2.8.2 = Elektra verbruik hoog tarief (DSMR v4.0)
      if (sscanf(buffer,"1-0:2.8.2(%ld.%ld" ,&tl, &tld)==2){
//      Serial.println("TmEVHT gevonden");
        tl *= 1000;
        tl += tld;
        TmEVHT = tl;
//    Serial.print("TmEVHT Zonnepaneel Hoog tarief: ");
//    Serial.print(TmEVHT);
//    Serial.println(" Watt");
      }

      // 1-0:1.7.0 = Electricity consumption actual usage (DSMR v4.0)
      if (sscanf(buffer,"1-0:1.7.0(%ld.%ld" ,&tl , &tld) == 2){
 //             Serial.println("mEAV gevonden");
        mEAV = (tl*1000)+tld;
//   Serial.print("mEAV Actueel : ");
//   Serial.print(mEAV);
//   Serial.println(" Watt");
      }

      // 1-0:2.7.0 = Electricity consumption actual usage (DSMR v4.0)
      if (sscanf(buffer,"1-0:2.7.0(%ld.%ld" ,&tl , &tld) == 2){
 //             Serial.println("mEAV gevonden");
        TmEAV = (tl*1000)+tld;
//    Serial.print("TmEAV Zonnepaneel Actueel : ");
//    Serial.print(TmEAV);
//    Serial.println(" Watt");
      }

      // 0-1:24.2.1 = Gas (DSMR v4.0) on Kaifa MA105 meter
      if (strncmp(buffer, "0-1:24.2.1", strlen("0-1:24.2.1")) == 0) {
        if (sscanf(strrchr(buffer, '(') + 1, "%d.%d", &tl, &tld) == 2) {
//      Serial.println("mG gevonden");
        mG = (tl*1000)+tld;
//    Serial.print("Gas : ");
//    Serial.print(mG);
//    Serial.println(" m2");
        }
      }

      // Empty buffer again (whole array)
      for (int i=0; i<75; i++)
      {
        buffer[i] = 0;
      }
      bufpos = 0;
    }
  } //Einde 'if AltSerial.available'
//  httpRequest();
} //Einde 'decodeTelegram()' functie

// void httpRequest() {
//   Serial.println("Send Request to RPi");
//   // if there's a successful connection:
//   if (client.connect(server, 80)) {
//     client.print("GET /get.php?mEVLT=");
//     client.print(PmEVLT);
//     client.print("&mEVHT=");
//     client.print(PmEVHT);
//     client.print("&TmEVLT=");
//     client.print(PTmEVLT);
//     client.print("&TmEVHT=");
//     client.print(PTmEVHT);
//     client.print("&mEAV=");
//     client.print(PmEAV);
//     client.print("&TmEAV=");
//     client.print(PTmEAV);
//     client.print("&gas=");
//     client.print(PmG);
//     client.println(" HTTP/1.1");
//     client.println("Host: 192.168.254.11");
//     client.println("User-Agent: arduino-ethernet");
//     client.println("Connection: close");
//     client.println();
//     //Request complete; empty recieve buffer
//     while (client.available()) { //data available
//       char c = client.read(); //gets byte from ethernet buffer
//     }
//     client.println();
//   }
//   else {
//     client.stop();
//   }
// }
