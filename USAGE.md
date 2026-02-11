# FIDE Embedded Dashboard - Usage Guide

## Getting Started

### Prerequisites

1. **Backend Server**: Make sure your FIDE backend server is running
   - Default URL: `http://localhost:3000`
   - The backend should have the following endpoints:
     - `GET /api/boards` - List available boards
     - `POST /api/projects` - Create new project
     - `GET /api/projects/:id/files/:path` - Get file content

2. **VS Code**: Version 1.85.0 or higher

### Installation

1. Press `F5` in the extension development workspace
2. This will open a new VS Code window with the extension loaded

### Configuration

Set your backend URL in VS Code settings:

1. Open Settings (Cmd+, or Ctrl+,)
2. Search for "FIDE"
3. Set `fide.backendUrl` to your backend server URL

## Using the Dashboard

### Opening the Dashboard

**Method 1: Command Palette**
1. Press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux)
2. Type "FIDE: Open Dashboard"
3. Press Enter

**Method 2: Future - Status Bar** (can be added)
- Click on the FIDE icon in the status bar

### Creating a New Project

1. **Open the Dashboard**
   - Use the command palette method above

2. **Enter Project Name**
   - Type a name for your project in the text field
   - Example: "my-stm32-project"

3. **Select a Board**
   - Click on one of the board cards
   - Available boards:
     - **STM32F4 Discovery** - ARM Cortex-M4, 192KB RAM, 1MB Flash
     - **ESP32 DevKitC** - Xtensa LX6, 520KB RAM, 4MB Flash
     - **Raspberry Pi Pico** - ARM Cortex-M0+, 264KB RAM, 2MB Flash
     - **Nordic nRF52840 DK** - ARM Cortex-M4, 256KB RAM, 1MB Flash
   - The selected card will be highlighted

4. **Create Project**
   - Click the "Create Project" button
   - Choose a folder where you want to save the project
   - Wait for the extension to:
     - Contact the backend
     - Create project container
     - Download template files
     - Generate workspace file

5. **Open Workspace**
   - When prompted, click "Open Workspace"
   - VS Code will reload with your new project

### Viewing Logs

The Log Viewer shows all activity from the extension:

1. **Switch to Log Viewer**
   - Click on the "Log Viewer" tab in the dashboard

2. **View Logs**
   - Logs are color-coded by level:
     - 🔵 **INFO** - Normal operations (blue)
     - 🟡 **WARNING** - Warnings (yellow)
     - 🔴 **ERROR** - Errors (red)
   - Each log entry shows:
     - Timestamp
     - Log level
     - Message

3. **Manage Logs**
   - **Refresh**: Click "Refresh" to update the log display
   - **Clear**: Click "Clear Logs" to remove all logs

## Project Structure

After creating a project, you'll have:

```
my-project/
├── src/
│   └── main.c           # Main application code
├── include/
│   └── board.h          # Board-specific definitions
├── Makefile             # Build configuration
├── README.md            # Project documentation
└── my-project.code-workspace  # VS Code workspace file
```

## Backend Integration

The extension communicates with your backend via REST API:

### Board List Request
```http
GET /api/boards
```

Returns a list of available boards with specifications.

### Create Project Request
```http
POST /api/projects
Content-Type: application/json

{
  "project_name": "my-project",
  "board_id": "stm32f4_discovery"
}
```

Returns project details including file tree.

### Get File Content
```http
GET /api/projects/{project_id}/files/{file_path}
```

Returns the content of a specific file.

## Troubleshooting

### Dashboard Won't Open
- Check the Output panel (View → Output)
- Select "FIDE Embedded Dashboard" from the dropdown
- Look for error messages

### Can't Connect to Backend
1. Verify backend is running:
   ```bash
   curl http://localhost:3000/api/boards
   ```
2. Check the backend URL in settings
3. Look at logs in the Log Viewer tab

### Project Creation Fails
1. Check backend logs
2. Verify the backend can access template files
3. Check the Log Viewer for detailed error messages

### Files Not Downloaded
- Ensure the backend API endpoints are working
- Check file paths in the backend response
- Verify write permissions in the project folder

## Tips

1. **Keep Dashboard Open**: The dashboard can stay open while you work
2. **Check Logs Regularly**: The Log Viewer helps debug issues
3. **Multiple Projects**: You can create multiple projects with different boards
4. **Customize Backend**: Change the backend URL in settings if using a remote server

## Next Steps

After creating your project:

1. **Explore the Template**: Look at the generated files
2. **Build the Project**: Use the build tools for your selected board
3. **Flash to Hardware**: Connect your board and flash the firmware
4. **Customize**: Modify the template to suit your needs

## Support

For issues and questions:
- Check the logs in the Log Viewer
- Review the backend API documentation
- Check VS Code's Output panel for extension logs
