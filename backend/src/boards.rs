use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardConfig {
    pub id: String,
    pub name: String,
    pub mcu: String,
    pub architecture: String,
    pub ram_kb: u32,
    pub flash_kb: u32,
    #[serde(skip)]
    pub template_path: String,
}

pub fn get_available_boards() -> Vec<BoardConfig> {
    let templates_dir = Path::new("templates");
    let mut boards = Vec::new();

    if let Ok(entries) = fs::read_dir(templates_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let board_json_path = path.join("board.json");
                if board_json_path.exists() {
                    if let Ok(content) = fs::read_to_string(&board_json_path) {
                        if let Ok(mut board) = serde_json::from_str::<BoardConfig>(&content) {
                            // Set template_path based on directory name
                            board.template_path = format!(
                                "templates/{}",
                                path.file_name().unwrap().to_string_lossy()
                            );
                            boards.push(board);
                        }
                    }
                }
            }
        }
    }

    boards
}

pub fn get_board_by_id(board_id: &str) -> Option<BoardConfig> {
    get_available_boards()
        .into_iter()
        .find(|b| b.id == board_id)
}
