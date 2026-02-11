#include <stdint.h>

// STM32F4 registers
#define RCC_BASE      0x40023800
#define GPIOD_BASE    0x40020C00

#define RCC_AHB1ENR   (*(volatile uint32_t *)(RCC_BASE + 0x30))
#define GPIOD_MODER   (*(volatile uint32_t *)(GPIOD_BASE + 0x00))
#define GPIOD_ODR     (*(volatile uint32_t *)(GPIOD_BASE + 0x14))

void delay(volatile uint32_t count) {
    while (count--) {
        __asm__("nop");
    }
}

int main(void) {
    // Enable GPIOD clock
    RCC_AHB1ENR |= (1 << 3);
    
    // Configure PD12-15 as output (LEDs on Discovery board)
    GPIOD_MODER &= ~0xFF000000;
    GPIOD_MODER |= 0x55000000;
    
    while (1) {
        // Toggle LEDs
        GPIOD_ODR ^= (1 << 12) | (1 << 13) | (1 << 14) | (1 << 15);
        delay(1000000);
    }
    
    return 0;
}
