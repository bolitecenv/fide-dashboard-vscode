use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::time::{interval, Duration};
use tracing::{info, error};

mod motor;
mod websocket;
mod config;
mod dlt_format;

use motor::MotorSimulator;
use websocket::start_websocket_server;
use config::Config;
use dlt_format::format_as_dlt_registers;

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    info!("Starting {{PROJECT_NAME}} - Motor Simulation");

    let config = Config::default();
    
    // Create broadcast channel for telemetry data
    let (tx, _rx) = broadcast::channel(100);
    let tx = Arc::new(tx);

    // Start WebSocket server
    let ws_tx = tx.clone();
    let ws_port = config.websocket_port;
    tokio::spawn(async move {
        if let Err(e) = start_websocket_server(ws_port, ws_tx).await {
            error!("WebSocket server error: {}", e);
        }
    });

    // Create motor simulator
    let mut motor = MotorSimulator::new(config);

    // Main simulation loop
    let mut tick_interval = interval(Duration::from_millis(100));
    
    loop {
        tick_interval.tick().await;
        
        // Update motor simulation
        motor.update(0.1); // 100ms = 0.1s
        
        // Get telemetry
        let telemetry = motor.get_telemetry();
        
        // Log to console
        info!(
            "Motor: speed={:.0} RPM, torque={:.1} Nm, temp={:.1}°C, current={:.2}A",
            telemetry.speed, telemetry.torque, telemetry.temperature, telemetry.current
        );
        
        // Send DLT formatted register messages to WebSocket clients
        let dlt_messages = format_as_dlt_registers(&telemetry);
        for msg in dlt_messages {
            let _ = tx.send(msg);
        }
    }
}
