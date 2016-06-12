 %module lora_interface
 %{
extern int setupLoRa();
extern int getLoRaStatus();
extern int sendLoRaMessage(int address, char *msg);
extern char *receiveLoRaMessage(void);
 %}

extern int setupLoRa();
extern int getLoRaStatus();
extern int sendLoRaMessage(int address, char *msg);
extern char *receiveLoRaMessage(void);
