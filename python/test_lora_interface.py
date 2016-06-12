import lora_interface

print("Calling setupLoRa...")
status = lora_interface.setupLoRa()
print(status)

print("Calling sendLoRaMessage...")
status = lora_interface.sendLoRaMessage(1, "test message")
print(status)

print("Calling receiveLoRaMessage...")
msg = lora_interface.receiveLoRaMessage()
print(msg)

print("Calling getLoRaStatus...")
status = lora_interface.getLoRaStatus()
print(status)
