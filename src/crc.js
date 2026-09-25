// CRC16/MODBUS (poly 0xA001 reflected, init 0xFFFF), as UART.crc16_modbus.
export function crc16modbus(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let j = 0; j < 8; j++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}
