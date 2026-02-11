use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tracing::info;

mod boards;
mod projects;
mod templates;

use boards::BoardConfig;
use projects::{CreateProjectRequest, CreateProjectResponse, ProjectManager};

#[derive(Clone)]
struct AppState {
    project_manager: Arc<ProjectManager>,
}

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter("fide_backend=debug,tower_http=debug")
        .init();

    // Initialize project manager
    let project_manager = Arc::new(ProjectManager::new());

    let state = AppState { project_manager };

    // Build CORS layer
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Build routes
    let app = Router::new()
        .route("/api/boards", get(get_boards))
        .route("/api/projects", post(create_project))
        .route("/api/projects/:id/files/*path", get(get_project_file))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000")
        .await
        .unwrap();

    info!("🚀 FIDE Backend listening on http://localhost:3000");

    axum::serve(listener, app).await.unwrap();
}

async fn get_boards() -> Json<Vec<BoardConfig>> {
    info!("GET /api/boards");
    Json(boards::get_available_boards())
}

async fn create_project(
    State(state): State<AppState>,
    Json(payload): Json<CreateProjectRequest>,
) -> Result<Json<CreateProjectResponse>, StatusCode> {
    info!(
        "POST /api/projects - project_name: {}, board_id: {}",
        payload.project_name, payload.board_id
    );

    match state
        .project_manager
        .create_project(&payload.project_name, &payload.board_id)
        .await
    {
        Ok(response) => Ok(Json(response)),
        Err(e) => {
            tracing::error!("Failed to create project: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_project_file(
    State(state): State<AppState>,
    Path((project_id, file_path)): Path<(String, String)>,
) -> Result<String, StatusCode> {
    info!(
        "GET /api/projects/{}/files/{}",
        project_id, file_path
    );

    match state
        .project_manager
        .get_file_content(&project_id, &file_path)
        .await
    {
        Ok(content) => Ok(content),
        Err(e) => {
            tracing::error!("Failed to get file: {}", e);
            Err(StatusCode::NOT_FOUND)
        }
    }
}
