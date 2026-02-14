# WASM Demo - Log & Service Message Generator/Parser

Complete guide to using the DLT Protocol R19-11 WASM bindings for log message generation, service message generation, and service message parsing in the browser.

## Quick Start

```bash
# 1. Build WASM
./build-wasm.sh

# 2. Start local server
python3 -m http.server 8000

# 3. Open test page
open http://localhost:8000/examples/wasm_service_test.html
```

## Overview

The WASM demo provides C ABI bindings for:
- **Log Message Generation** — Generate DLT log messages with configurable verbose/non-verbose mode
- **Service Request Generation** — Generate DLT service requests (SetLogLevel, GetLogInfo, GetDefaultLogLevel, GetSoftwareVersion)
- **Service Response Generation** — Generate typed service responses with parameters
- **Service Message Parsing** — Parse any DLT service message and extract fields
- **Memory Management** — Allocate, deallocate, and inspect WASM heap

## Files

- **[examples/wasm_demo.rs](examples/wasm_demo.rs)** (800+ lines) — WASM C ABI bindings
- **[examples/wasm_service_test.html](examples/wasm_service_test.html)** (365 lines) — Interactive test UI
- **[examples/wasm_test.html](examples/wasm_test.html)** — Legacy test page (basic functionality)
- **[build-wasm.sh](build-wasm.sh)** — Build script

## C ABI Functions

All functions use C calling convention with return values as `i32` (size on success, negative error code on failure).

### Memory Management

#### `allocate(size: u32) -> u32`
Allocate memory on the WASM heap (8-byte aligned).

**Returns:** pointer to allocated memory, or 0 on failure

```c
uint32_t ptr = allocate(256);
// use ptr...
deallocate(ptr);
```

#### `deallocate(ptr: u32)`
Free allocated memory.

#### `reset_allocator()`
Reset allocator (clears all allocated memory).

#### `get_heap_capacity() -> u32`
Get total heap size (16384 bytes).

#### `get_heap_usage() -> u32`
Get currently allocated bytes.

#### `get_version() -> u32`
Get library info as packed u32: version bytes (major.minor.patch).

---

## Log Message Generation

### `generate_log_message(config_ptr: u32, payload_ptr: u32, payload_len: u32, out_ptr: u32, out_len: u32) -> i32`

Generate a configurable DLT log message (verbose or non-verbose mode).

**Config Structure (24 bytes):**
```
Offset  Type    Field
0-3     [u8;4]  ECU ID (e.g., "ECU1")
4-7     [u8;4]  App ID (e.g., "APP1")
8-11    [u8;4]  Context ID (e.g., "CTX1")
12      u8      Log level (1-6: Fatal, Error, Warn, Info, Debug, Verbose)
13      u8      Verbose mode (0=non-verbose, 1=verbose with type info)
14      u8      Number of arguments (0-15)
15      u8      Reserved
16-19   u32-LE  Timestamp (optional, in milliseconds)
20-23   u32     Reserved
```

**Usage (JavaScript):**
```javascript
const config = wasm.allocate(24);
const m = new Uint8Array(wasm.memory.buffer);
const dv = new DataView(wasm.memory.buffer);

// Write ECU ID, App ID, Context ID (4 bytes each)
function writeId(ptr, s) {
    for (let i = 0; i < 4; i++) {
        m[ptr + i] = i < s.length ? s.charCodeAt(i) : 0;
    }
}

writeId(config, "ECU1");      // offset 0
writeId(config + 4, "APP1");  // offset 4
writeId(config + 8, "CTX1");  // offset 8

m[config + 12] = 4;  // Log level: Info
m[config + 13] = 1;  // Verbose: Yes
m[config + 14] = 1;  // Number of arguments

// Write timestamp (little-endian)
dv.setUint32(config + 16, 12345, true);

// Create payload
const payloadText = "Hello WASM!";
const payloadPtr = wasm.allocate(payloadText.length);
const payloadData = new Uint8Array(wasm.memory.buffer, payloadPtr, payloadText.length);
payloadData.set(new TextEncoder().encode(payloadText));

// Generate message
const outPtr = wasm.allocate(512);
const size = wasm.generate_log_message(config, payloadPtr, payloadText.length, outPtr, 512);

if (size > 0) {
    const message = new Uint8Array(wasm.memory.buffer, outPtr, size);
    console.log("Generated:", Array.from(message).map(b => b.toString(16).padStart(2, '0')).join(' '));
}
```

---

## Service Request Generation

### `generate_set_log_level_request(config_ptr: u32, target_app_ptr: u32, target_ctx_ptr: u32, log_level: u32, out_ptr: u32, out_len: u32) -> i32`

Generate SetLogLevel (0x01) service request.

**Config Structure (12 bytes):**
```
Offset  Field
0-3     ECU ID [u8;4]
4-7     App ID [u8;4]
8-11    Context ID [u8;4]
```

**Parameters:**
- `target_app_ptr`: Pointer to 4-byte target App ID
- `target_ctx_ptr`: Pointer to 4-byte target Context ID
- `log_level`: Log level to set (1-6)

### `generate_get_log_info_request(config_ptr: u32, options: u32, target_app_ptr: u32, target_ctx_ptr: u32, out_ptr: u32, out_len: u32) -> i32`

Generate GetLogInfo (0x03) service request.

**Parameters:**
- `options`: Info options bitmask (typically 7 for full info)
- `target_app_ptr`: Pointer to 4-byte target App ID (or zeros for wildcard)
- `target_ctx_ptr`: Pointer to 4-byte target Context ID (or zeros for wildcard)

### `generate_get_default_log_level_request(config_ptr: u32, out_ptr: u32, out_len: u32) -> i32`

Generate GetDefaultLogLevel (0x04) service request. No additional parameters needed.

### `generate_get_software_version_request(config_ptr: u32, out_ptr: u32, out_len: u32) -> i32`

Generate GetSoftwareVersion (0x13) service request. No additional parameters needed.

---

## Service Response Generation

### `generate_service_response(config_ptr: u32, service_id: u32, status: u32, out_ptr: u32, out_len: u32) -> i32`

Generate generic status response for any service ID.

**Parameters:**
- `service_id`: DLT service ID (1=SetLogLevel, 3=GetLogInfo, 4=GetDefaultLogLevel, 19=GetSoftwareVersion, etc.)
- `status`: Status code (0=OK, 1=NOT_SUPPORTED, 2=ERROR, 3=PENDING, etc.)

### `generate_get_default_log_level_response(config_ptr: u32, status: u32, log_level: u32, out_ptr: u32, out_len: u32) -> i32`

Generate typed GetDefaultLogLevel (0x04) response with log level parameter.

**Parameters:**
- `status`: Response status
- `log_level`: Default log level to return (1-6)

### `generate_get_software_version_response(config_ptr: u32, status: u32, version_ptr: u32, version_len: u32, out_ptr: u32, out_len: u32) -> i32`

Generate typed GetSoftwareVersion (0x13) response with version string.

**Parameters:**
- `status`: Response status
- `version_ptr`: Pointer to version string bytes (e.g., "1.2.3")
- `version_len`: Length of version string

**Usage Example:**
```javascript
const config = wasm.allocate(12);
// ... write config ...

const version = "1.2.3";
const verPtr = wasm.allocate(version.length);
const verData = new Uint8Array(wasm.memory.buffer, verPtr, version.length);
verData.set(new TextEncoder().encode(version));

const outPtr = wasm.allocate(512);
const size = wasm.generate_get_software_version_response(
    config, 0, // status=OK
    verPtr, version.length,
    outPtr, 512
);
```

---

## Service Message Parsing

### `parse_service_message(buffer_ptr: u32, buffer_len: u32, result_ptr: u32) -> i32`

Parse any DLT service message and extract all relevant fields.

**Result Structure (48 bytes):**
```
Offset  Type    Field
0-3     u32-LE  Service ID (1=SetLogLevel, 3=GetLogInfo, 4=GetDefaultLogLevel, 0x13=GetSoftwareVersion, etc.)
4       u8      Is Response (0=request, 1=response)
5       u8      Status (0=OK, 1=NOT_SUPPORTED, 2=ERROR; only in responses)
6       u8      MSTP (message type)
7       u8      MTIN (message type info)
8-11    [u8;4]  ECU ID
12-15   [u8;4]  App ID
16-19   [u8;4]  Context ID
20-21   u16-LE  Payload length
22-23   u16-LE  Payload offset (from start of buffer)
24-27   u32-LE  Param1 / Target App ID (SetLogLevel request)
28-31   u32-LE  Param2 / Target Context ID (SetLogLevel request)
32      u8      Param3 / Log Level (SetLogLevel, GetDefaultLogLevel response)
33-47   [u8;15] Reserved
```

**Returns:** 0 on success, negative error code on failure

**Usage Example (JavaScript):**
```javascript
// Generate or load a service message
const msgBytes = [/* hex bytes */];
const msgPtr = wasm.allocate(msgBytes.length);
const m = new Uint8Array(wasm.memory.buffer, msgPtr, msgBytes.length);
m.set(msgBytes);

// Parse it
const resultPtr = wasm.allocate(48);
const rc = wasm.parse_service_message(msgPtr, msgBytes.length, resultPtr);

if (rc === 0) {
    const result = new Uint8Array(wasm.memory.buffer, resultPtr, 48);
    const dv = new DataView(wasm.memory.buffer, resultPtr);
    
    const serviceId = dv.getUint32(0, true);
    const isResponse = result[4];
    const status = result[5];
    const ecuId = String.fromCharCode(...result.slice(8, 12));
    const appId = String.fromCharCode(...result.slice(12, 16));
    const ctxId = String.fromCharCode(...result.slice(16, 20));
    const payloadLen = dv.getUint16(20, true);
    const payloadOff = dv.getUint16(22, true);
    
    console.log(`Service 0x${serviceId.toString(16)}: ${isResponse ? 'Response' : 'Request'}`);
    console.log(`  Status: ${status}`);
    console.log(`  ECU: "${ecuId}", App: "${appId}", Ctx: "${ctxId}"`);
    console.log(`  Payload: ${payloadLen} bytes @ offset ${payloadOff}`);
    
    // Service-specific field extraction
    if (serviceId === 0x01) { // SetLogLevel
        const tApp = dv.getUint32(24, true);
        const tCtx = dv.getUint32(28, true);
        const level = result[32];
        console.log(`  Target App: 0x${tApp.toString(16)}`);
        console.log(`  Target Ctx: 0x${tCtx.toString(16)}`);
        console.log(`  Log Level: ${level}`);
    } else if (serviceId === 0x04) { // GetDefaultLogLevel (response)
        const level = result[32];
        console.log(`  Default Log Level: ${level}`);
    } else if (serviceId === 0x13) { // GetSoftwareVersion
        if (isResponse) {
            const verLen = dv.getUint32(24, true);
            const verOff = dv.getUint32(28, true);
            if (verLen > 0 && verOff < msgBytes.length) {
                const verBytes = m.slice(verOff, verOff + verLen);
                console.log(`  SW Version: "${String.fromCharCode(...verBytes)}"`);
            }
        }
    }
    
    wasm.deallocate(msgPtr);
    wasm.deallocate(resultPtr);
}
```

---

## Service ID Reference

| ID   | Name                       | Type    |
|------|----------------------------|---------|
| 0x01 | SetLogLevel                | Req/Resp |
| 0x02 | SetTraceStatus             | Req/Resp |
| 0x03 | GetLogInfo                 | Req/Resp |
| 0x04 | GetDefaultLogLevel         | Req/Resp |
| 0x05 | StoreConfiguration         | Req/Resp |
| 0x06 | ResetToFactoryDefault      | Req/Resp |
| 0x0A | SetMessageFiltering        | Req/Resp |
| 0x11 | SetDefaultLogLevel         | Req/Resp |
| 0x12 | SetDefaultTraceStatus      | Req/Resp |
| 0x13 | GetSoftwareVersion         | Req/Resp |
| 0x15 | GetDefaultTraceStatus      | Req/Resp |
| 0x17 | GetLogChannelNames         | Req/Resp |
| 0x1F | GetTraceStatus             | Req/Resp |

## Status Codes

| Code | Name              |
|------|-------------------|
| 0    | OK                |
| 1    | NOT_SUPPORTED     |
| 2    | ERROR             |
| 3    | PENDING           |
| 6    | WITH_LOG_LEVEL_AND_TRACE_STATUS |
| 7    | WITH_DESCRIPTIONS |
| 8    | NO_MATCHING_CONTEXTS |
| 9    | OVERFLOW          |

---

## Log Levels

| Value | Name    |
|-------|---------|
| 1     | Fatal   |
| 2     | Error   |
| 3     | Warn    |
| 4     | Info    |
| 5     | Debug   |
| 6     | Verbose |

---

## Usage Patterns

### Round-Trip Test (Generate → Parse)

```javascript
// 1. Generate a service request
const config = wasm.allocate(12);
// ... write config ...

const outPtr = wasm.allocate(512);
const size = wasm.generate_set_log_level_request(config, appPtr, ctxPtr, 4, outPtr, 512);

// 2. Parse the generated message
const resultPtr = wasm.allocate(48);
const rc = wasm.parse_service_message(outPtr, size, resultPtr);

if (rc === 0) {
    // Extract and verify fields
    const result = new DataView(wasm.memory.buffer, resultPtr);
    const serviceId = result.getUint32(0, true);
    console.log(`Generated and parsed service 0x${serviceId.toString(16)}`);
}
```

### Batch Message Generation

```javascript
function generateMessage(ecuId, appId, ctxId, msgType, params) {
    const config = wasm.allocate(getConfigSize(msgType));
    // ... setup config ...
    
    const outPtr = wasm.allocate(512);
    let size = -1;
    
    switch (msgType) {
        case 'log':
            // ... setup log params ...
            size = wasm.generate_log_message(config, payloadPtr, payloadLen, outPtr, 512);
            break;
        case 'set_log_level':
            size = wasm.generate_set_log_level_request(config, params.app, params.ctx, params.level, outPtr, 512);
            break;
        // ... etc ...
    }
    
    return { ptr: outPtr, size };
}

const messages = [
    generateMessage("ECU1", "APP1", "CTX1", "log", { level: 4 }),
    generateMessage("ECU1", "APP1", "CTX1", "set_log_level", { app: "APP2", ctx: "CTX2", level: 5 }),
    // ... more messages ...
];

messages.forEach(msg => {
    if (msg.size > 0) {
        console.log(`Generated ${msg.size} bytes`);
    }
});
```

### Memory-Efficient Parsing Loop

```javascript
function parseMessages(hexString) {
    const bytes = hexString.trim().split(/[\s,]+/).map(h => parseInt(h, 16));
    
    // Allocate once
    const msgPtr = wasm.allocate(bytes.length);
    const resultPtr = wasm.allocate(48);
    
    const m = new Uint8Array(wasm.memory.buffer, msgPtr, bytes.length);
    m.set(bytes);
    
    const rc = wasm.parse_service_message(msgPtr, bytes.length, resultPtr);
    
    if (rc === 0) {
        const result = new Uint8Array(wasm.memory.buffer, resultPtr, 48);
        // Process result...
    }
    
    // Single deallocation
    wasm.deallocate(msgPtr);
    wasm.deallocate(resultPtr);
}
```

---

## Troubleshooting

### WASM Module Not Loading
- Ensure `./build-wasm.sh` was run successfully
- Check that `target/wasm32-unknown-unknown/release/examples/wasm_demo.wasm` exists
- Browser console should show fetch error if WASM load fails

### Buffer Too Small Error
- Return value < 0 indicates error
- Increase output buffer size from 512 to 1024 or more
- Log level: increase from 256 to 512

### Invalid Config Structure
- Ensure ECU ID, App ID, Context ID are exactly 4 bytes each (pad with nulls)
- Little-endian fields: use `DataView.setUint32(..., true)` for LE
- Check field offsets match documentation

### Heap Exhaustion
- Call `reset_allocator()` between test batches
- Call `deallocate()` on pointers no longer needed
- Check `get_heap_usage()` to monitor

---

## Interactive Test Page

The included [wasm_service_test.html](examples/wasm_service_test.html) provides:

- **Log Message Generator** — Configure ECU/App/Ctx IDs, log level, verbose mode, payload text
- **Service Request Generator** — Generate all 4 request types with parameters
- **Service Response Generator** — Generate typed responses with status and parameters
- **Parser Section** — Hex input or "Parse Last Generated" for round-trip testing
- **Hex Visualization** — All generated messages shown in hex format with byte counts

Open in browser: `http://localhost:8000/examples/wasm_service_test.html`

---

## Performance Notes

- **Build size:** ~43 KB (optimized release)
- **Memory overhead:** 16 KB WASM heap (can be adjusted in [wasm_demo.rs](examples/wasm_demo.rs) line ~12)
- **Zero external dependencies:** Pure Rust, no JavaScript libraries required
- **No `std` library:** Runs in bare WASM environment

---

## Limitations & Future Work

- Service message types (standard requests/responses) only — custom payload encoding not yet exposed
- GetLogInfo response parsing incomplete (reserved for future expansion)
- No async/streaming support (all operations are synchronous)

See [.github/copilot-instructions.md](.github/copilot-instructions.md) for detailed architecture and implementation notes.
