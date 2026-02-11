use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
}

pub fn generate_file_tree(template_path: &str, project_name: &str) -> Result<Vec<FileNode>, String> {
    let base_path = Path::new(template_path);
    
    if !base_path.exists() {
        return Err(format!("Template path does not exist: {}", template_path));
    }

    let mut root_nodes = Vec::new();

    for entry in WalkDir::new(base_path)
        .min_depth(1)
        .max_depth(1)
        .sort_by_file_name()
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let relative_path = path
            .strip_prefix(base_path)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .to_string();

        let node = if path.is_dir() {
            FileNode {
                name: entry.file_name().to_string_lossy().to_string(),
                path: relative_path.clone(),
                is_directory: true,
                children: Some(build_tree_recursive(path, base_path)?),
            }
        } else {
            FileNode {
                name: entry.file_name().to_string_lossy().to_string(),
                path: relative_path,
                is_directory: false,
                children: None,
            }
        };

        root_nodes.push(node);
    }

    Ok(root_nodes)
}

fn build_tree_recursive(dir: &Path, base_path: &Path) -> Result<Vec<FileNode>, String> {
    let mut children = Vec::new();

    for entry in WalkDir::new(dir)
        .min_depth(1)
        .max_depth(1)
        .sort_by_file_name()
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let relative_path = path
            .strip_prefix(base_path)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .to_string();

        let node = if path.is_dir() {
            FileNode {
                name: entry.file_name().to_string_lossy().to_string(),
                path: relative_path,
                is_directory: true,
                children: Some(build_tree_recursive(path, base_path)?),
            }
        } else {
            FileNode {
                name: entry.file_name().to_string_lossy().to_string(),
                path: relative_path,
                is_directory: false,
                children: None,
            }
        };

        children.push(node);
    }

    Ok(children)
}

pub fn get_template_file_content(
    template_path: &str,
    file_path: &str,
    project_name: &str,
) -> Result<String, String> {
    let full_path = Path::new(template_path).join(file_path);

    let content = fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read file {}: {}", full_path.display(), e))?;

    // Replace template variables
    let content = content.replace("{{PROJECT_NAME}}", project_name);

    Ok(content)
}
