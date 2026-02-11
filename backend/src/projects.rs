use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;
use uuid::Uuid;

use crate::boards::get_board_by_id;
use crate::templates::{FileNode, generate_file_tree, get_template_file_content};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectRequest {
    pub project_name: String,
    pub board_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectResponse {
    pub project_id: String,
    pub container_id: String,
    pub file_tree: Vec<FileNode>,
    pub workspace_url: String,
}

#[derive(Debug, Clone)]
struct ProjectInfo {
    project_id: String,
    container_id: String,
    project_name: String,
    board_id: String,
    template_path: String,
}

pub struct ProjectManager {
    projects: RwLock<HashMap<String, ProjectInfo>>,
}

impl ProjectManager {
    pub fn new() -> Self {
        Self {
            projects: RwLock::new(HashMap::new()),
        }
    }

    pub async fn create_project(
        &self,
        project_name: &str,
        board_id: &str,
    ) -> Result<CreateProjectResponse, String> {
        let board = get_board_by_id(board_id)
            .ok_or_else(|| format!("Board not found: {}", board_id))?;

        let project_id = Uuid::new_v4().to_string();
        let container_id = Uuid::new_v4().to_string();

        // Generate file tree from template
        let file_tree = generate_file_tree(&board.template_path, project_name)?;

        // Store project info
        let project_info = ProjectInfo {
            project_id: project_id.clone(),
            container_id: container_id.clone(),
            project_name: project_name.to_string(),
            board_id: board_id.to_string(),
            template_path: board.template_path.clone(),
        };

        self.projects
            .write()
            .unwrap()
            .insert(project_id.clone(), project_info);

        Ok(CreateProjectResponse {
            project_id: project_id.clone(),
            container_id,
            file_tree,
            workspace_url: format!("/workspace/{}", project_id),
        })
    }

    pub async fn get_file_content(
        &self,
        project_id: &str,
        file_path: &str,
    ) -> Result<String, String> {
        let projects = self.projects.read().unwrap();
        let project = projects
            .get(project_id)
            .ok_or_else(|| format!("Project not found: {}", project_id))?;

        get_template_file_content(&project.template_path, file_path, &project.project_name)
    }
}
