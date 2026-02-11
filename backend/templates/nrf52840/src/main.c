#include <stdint.h>
#include <stdbool.h>

// nRF52840 GPIO registers
#define P0_BASE     0x50000000
#define P0_OUT      (*(volatile uint32_t *)(P0_BASE + 0x504))
#define P0_OUTSET   (*(volatile uint32_t *)(P0_BASE + 0x508))
#define P0_OUTCLR   (*(volatile uint32_t *)(P0_BASE + 0x50C))
#define P0_DIRSET   (*(volatile uint32_t *)(P0_BASE + 0x518))

#define LED1 13  // LED1 on nRF52840 DK

void delay(volatile uint32_t count) {
    while (count--) {
        __asm__("nop");
    }
}

int main(void) {
    // Configure LED1 as output
    P0_DIRSET = (1 << LED1);
    
    while (true) {
        // Toggle LED
        P0_OUTSET = (1 << LED1);
        delay(1000000);
        P0_OUTCLR = (1 << LED1);
        delay(1000000);
    }
    
    return 0;
}
