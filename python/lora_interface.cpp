#include <msgpack.hpp>
#include <vector>
#include <string>
#include <iostream>
#include "arduPiLoRa.h"  //  Include the SX1272 and SPI library. 

int e;
char my_packet[100];
char message1 [] = "Packet 1, wanting to see if received packet is the same as sent packet";
char message2 [] = "Packet 2, broadcast test";

////
static int setupDone = 0;
static int sendCount = 0;
static int receiveCount = 0;

int getLoRaStatus()
{
  // serializes this object.
  std::vector<std::string> vec;
  vec.push_back("Hello");
  vec.push_back("MessagePack");

  // serialize it into simple buffer.
  msgpack::sbuffer sbuf;
  msgpack::pack(sbuf, vec);

  // deserialize it.
  msgpack::object_handle oh =
      msgpack::unpack(sbuf.data(), sbuf.size());

  // print the deserialized object.
  msgpack::object obj = oh.get();
  std::cout << obj << std::endl;  //=> ["Hello", "MessagePack"]

  // convert it into statically typed object.
  std::vector<std::string> rvec;
  obj.convert(rvec);

  return e;
}

int setupLoRa()
{
  // Print a start message
  printf("setupLoRa: SX1272 module and Raspberry Pi: send packets without ACK\n");
  
  // Power ON the module
  e = sx1272.ON();
  printf("setupLoRa: Setting power ON: state %d\n", e);
  
  // Set transmission mode
  e = sx1272.setMode(4);
  printf("setupLoRa: Setting Mode: state %d\n", e);
  
  // Set header
  e = sx1272.setHeaderON();
  printf("setupLoRa: Setting Header ON: state %d\n", e);
  
  // Select frequency channel
  e = sx1272.setChannel(CH_10_868);
  printf("setupLoRa: Setting Channel: state %d\n", e);
  
  // Set CRC
  e = sx1272.setCRC_ON();
  printf("setupLoRa: Setting CRC ON: state %d\n", e);
  
  // Select output power (Max, High or Low)
  e = sx1272.setPower('H');
  printf("setupLoRa: Setting Power: state %d\n", e);
  
  // Set the node address
  e = sx1272.setNodeAddress(3);
  printf("setupLoRa: Setting Node address: state %d\n", e);
  
  // Print a success message
  printf("setupLoRa: SX1272 successfully configured\n\n");
  delay(1000);

  ////
  setupDone++;
  printf("setupLoRa: done %d, %d, %d\n", setupDone, sendCount, receiveCount);
  return e;
}

int sendLoRaMessage(int address, char *msg)
{
	  // Send message and print the result
    printf("sendLoRaMessage: address=%d, msg=%s\n", address, msg);
    if (setupDone == 0)
    {
      printf("sendLoRaMessage ERROR: setupLoRa not called");
      return -1;
    }
    //  TODO: If message starts with "{", assume it's in JSON format and compress with MessagePack.
    e = sx1272.sendPacketTimeout(address, msg);
    printf("sendLoRaMessage: state=%d\n",e);

    ////
    sendCount++;
    printf("sendLoRaMessage: done %d, %d, %d\n", setupDone, sendCount, receiveCount);
    return e;
}

char *receiveLoRaMessage(void)
{
  // Receive message
  printf("receiveLoRaMessage: start\n");
  if (setupDone == 0)
  {
    printf("sendLoRaMessage ERROR: setupLoRa not called");
    return (char *) "ERROR";
  }
  e = sx1272.receivePacketTimeout(10000);
  if ( e == 0 )
  {
    printf("receiveLoRaMessage: state=%d\n",e);

    for (unsigned int i = 0; i < sx1272.packet_received.length; i++)
    {
      my_packet[i] = (char)sx1272.packet_received.data[i];
    }
    printf("receiveLoRaMessage: message=%s\n", my_packet);
  }
  else {
    printf("receiveLoRaMessage: state=%d\n",e);
  }

  ////
  //  TODO: If message does not start with "{", assume it's in MessagePack format and uncompress to JSON format.
  receiveCount++;
  printf("receiveLoRaMessage: done %d, %d, %d\n", setupDone, sendCount, receiveCount);
  return my_packet;
}

int main() {
	int setupStatus = setupLoRa();
  printf("Setup status %d\n",setupStatus);
	while(1){
    // Send message1 and print the result
    e = sendLoRaMessage(8, message1);
    printf("Packet sent, state %d\n",e);
    
    delay(4000);
 
    // Send message2 broadcast and print the result
    e = sendLoRaMessage(0, message2);
    printf("Packet sent, state %d\n",e);

    //  Receive a message.
		char *msg = receiveLoRaMessage();
    printf("Received message: %s\n", msg);

    //  Show the receive status.
    int status = getLoRaStatus();
    printf("Receive status: %d\n", status);    
	}
	return (0);
}

        
