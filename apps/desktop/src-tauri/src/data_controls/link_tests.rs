//! TASK-018: app-owned paths are checked for links from the data folder down; the folders above it are trusted
//! as the OS resolved them. User-chosen export and restore paths keep the full walk.
use super::*;
use std::{fs, path::Path};

#[test]
fn the_anchored_check_refuses_a_path_outside_its_anchor() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("com.fundedflow.desktop");
    fs::create_dir_all(&root).unwrap();
    filesystem::no_link_below(&root, &root).unwrap();
    filesystem::no_link_below(&root, &root.join("data-controls-work").join("x")).unwrap();
    for outside in [
        dir.path().to_path_buf(),
        dir.path().join("elsewhere"),
        root.join("..").join("elsewhere"),
    ] {
        assert_eq!(
            filesystem::no_link_below(&root, &outside).unwrap_err().code,
            Code::UnsafePath,
            "{}",
            outside.display()
        );
    }
}

/// A directory junction `link` -> `target`, made the way a relocated profile or Roaming folder is.
#[cfg(windows)]
fn junction(link: &Path, target: &Path) {
    let made = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .output()
        .unwrap();
    assert!(made.status.success(), "mklink /J failed: {made:?}");
}

/// `<temp>/profile` is a junction to `<temp>/real-profile`; returns the data folder below it (created).
#[cfg(windows)]
fn root_under_junction(dir: &Path) -> std::path::PathBuf {
    let real = dir.join("real-profile");
    fs::create_dir_all(&real).unwrap();
    junction(&dir.join("profile"), &real);
    let root = dir.join("profile").join("com.fundedflow.desktop");
    fs::create_dir_all(&root).unwrap();
    root
}

#[cfg(windows)]
#[test]
fn a_junction_above_the_data_folder_is_trusted_but_still_refused_on_user_paths() {
    let dir = tempfile::tempdir().unwrap();
    let root = root_under_junction(dir.path());
    let lock = root.join("fundedflow.lock");
    filesystem::no_link_below(&root, &lock).unwrap();
    filesystem::write_new_under(&root, &root.join("data-controls-work").join("a.bin"), b"x")
        .unwrap();
    filesystem::private_dir(&root, &root.join("data-controls")).unwrap();
    drop(filesystem_ownership(&root).unwrap());
    // A user-chosen export or restore path under the same junction keeps the full walk (TR-007/WIN-002).
    assert_eq!(
        filesystem::no_symlink_components(&root.join("backup.zip"))
            .unwrap_err()
            .code,
        Code::UnsafePath
    );
    assert_eq!(
        filesystem::write_new(&root.join("export.json"), b"x")
            .unwrap_err()
            .code,
        Code::UnsafePath
    );
    assert!(!root.join("export.json").exists());
}

#[cfg(windows)]
#[test]
fn a_junction_at_or_inside_the_data_folder_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let outside = dir.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    // At the data folder itself.
    let linked_root = dir.path().join("com.fundedflow.desktop");
    junction(&linked_root, &outside);
    for path in [linked_root.clone(), linked_root.join("fundedflow.lock")] {
        assert_eq!(
            filesystem::no_link_below(&linked_root, &path)
                .unwrap_err()
                .code,
            Code::UnsafePath
        );
    }
    assert_eq!(
        filesystem_ownership(&linked_root).unwrap_err().code,
        Code::UnsafePath
    );
    // Inside a data folder that sits under a trusted junction.
    let root = root_under_junction(dir.path());
    junction(&root.join("data-controls-work"), &outside);
    let staged = root.join("data-controls-work").join("staged.bin");
    assert_eq!(
        filesystem::no_link_below(&root, &staged).unwrap_err().code,
        Code::UnsafePath
    );
    assert_eq!(
        filesystem::write_new_under(&root, &staged, b"x")
            .unwrap_err()
            .code,
        Code::UnsafePath
    );
    assert_eq!(
        filesystem::private_dir(&root, &root.join("data-controls-work").join("op"))
            .unwrap_err()
            .code,
        Code::UnsafePath
    );
    // Through a data control: a whole-journal erase preview refuses the linked work folder.
    let c = super::tests::journal(&root.join("fundedflow.db"));
    let erase = deletion::preview(
        &c,
        &root,
        deletion::PreviewRequest {
            scope: deletion::Scope::Journal,
        },
    )
    .unwrap_err();
    assert_eq!(erase.code, Code::UnsafePath);
    // Nothing was written behind any link.
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
}
