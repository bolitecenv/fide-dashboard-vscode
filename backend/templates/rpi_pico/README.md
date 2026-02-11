# {{PROJECT_NAME}}

Raspberry Pi Pico Project

## Board: RP2040
- **Architecture**: ARM Cortex-M0+
- **RAM**: 264 KB
- **Flash**: 2 MB

## Build

```bash
mkdir build && cd build
cmake ..
make
```

## Flash

Connect Pico in BOOTSEL mode and copy the .uf2 file to the drive.

## Features

- LED blink example
- GPIO configuration
- PIO (Programmable I/O)
- USB support
