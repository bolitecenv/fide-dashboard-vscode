use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;
use futures::{SinkExt, StreamExt};
use tracing::{info, error, warn};

pub async fn start_websocket_server(
    port: u16,
    tx: Arc<broadcast::Sender<String>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let addr = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&addr).await?;
    
    info!("WebSocket server listening on ws://{}", addr);

    while let Ok((stream, peer_addr)) = listener.accept().await {
        info!("New WebSocket connection from: {}", peer_addr);
        let tx = tx.clone();
        tokio::spawn(handle_connection(stream, tx, peer_addr.to_string()));
    }

    Ok(())
}

async fn handle_connection(
    stream: TcpStream,
    tx: Arc<broadcast::Sender<String>>,
    peer_addr: String,
) {
    let ws_stream = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            error!("WebSocket handshake error from {}: {}", peer_addr, e);
            return;
        }
    };

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let mut rx = tx.subscribe();

    // Send initial connection message
    let welcome = serde_json::json!({
        "type": "connected",
        "message": "Connected to motor simulation"
    });
    if let Ok(msg) = serde_json::to_string(&welcome) {
        let _ = ws_sender.send(Message::Text(msg)).await;
    }

    // Spawn task to receive messages from broadcast channel and send to WebSocket
    let send_task = tokio::spawn(async move {
        while let Ok(data) = rx.recv().await {
            if let Err(e) = ws_sender.send(Message::Text(data)).await {
                warn!("Error sending to WebSocket: {}", e);
                break;
            }
        }
    });

    // Handle incoming WebSocket messages (for future control commands)
    while let Some(msg) = ws_receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                info!("Received from {}: {}", peer_addr, text);
                // Future: handle control commands here
            }
            Ok(Message::Close(_)) => {
                info!("Client {} disconnected", peer_addr);
                break;
            }
            Err(e) => {
                error!("WebSocket error from {}: {}", peer_addr, e);
                break;
            }
            _ => {}
        }
    }

    send_task.abort();
    info!("Connection closed: {}", peer_addr);
}
