//! Classify explicit filesystem deletion commands without executing them.
//! This is not a detector for arbitrary interpreter code or external scripts.
use super::is_dangerous_command::DangerousCommandPlatform;
use crate::bash::parse_shell_lc_literal_commands;
use crate::powershell::extract_powershell_command;

pub fn is_deletion_command(command: &[String], platform: DangerousCommandPlatform) -> bool {
    classify(command, platform, 0)
}

fn classify(command: &[String], platform: DangerousCommandPlatform, depth: usize) -> bool {
    if depth > 8 {
        return false;
    }
    let Some((program, args)) = command.split_first() else {
        return false;
    };
    let name = executable_name(program, platform);
    if matches!(name.as_str(), "rm" | "unlink" | "rmdir") {
        return !args.is_empty()
            && (platform == DangerousCommandPlatform::Windows
                || !args
                    .iter()
                    .take_while(|arg| arg.as_str() != "--")
                    .any(|arg| arg == "--help" || arg == "--version"));
    }
    if name == "find" && platform == DangerousCommandPlatform::Posix {
        return args.iter().any(|arg| arg == "-delete")
            || args
                .iter()
                .position(|arg| matches!(arg.as_str(), "-exec" | "-execdir"))
                .is_some_and(|index| classify(&args[index + 1..], platform, depth + 1));
    }
    if matches!(name.as_str(), "sudo" | "env") {
        // Only unwrap known option-free wrappers, including env assignments.
        let start = args
            .iter()
            .position(|arg| !arg.contains('='))
            .unwrap_or(args.len());
        if args.get(start).is_some_and(|arg| !arg.starts_with('-')) {
            return classify(&args[start..], platform, depth + 1);
        }
    }
    if let Some(commands) = parse_shell_lc_literal_commands(command)
        && commands
            .iter()
            .any(|cmd| classify(cmd, platform, depth + 1))
    {
        return true;
    }
    if platform != DangerousCommandPlatform::Windows {
        return false;
    }
    if let Some((_, script)) = extract_powershell_command(command) {
        return powershell_script_deletes(script);
    }
    if matches!(name.as_str(), "cmd" | "cmd.exe") {
        let Some(index) = args.iter().position(|arg| {
            arg.eq_ignore_ascii_case("/c")
                || arg.eq_ignore_ascii_case("/k")
                || arg.eq_ignore_ascii_case("/r")
        }) else {
            return false;
        };
        let script = args[index + 1..].join(" ");
        // CMD operators delimit commands even without surrounding spaces.
        return script.split(['&', '|', '\n', '\r']).any(|segment| {
            let words = shlex::split(segment).unwrap_or_default();
            words.first().is_some_and(|name| {
                matches!(
                    name.to_ascii_lowercase().as_str(),
                    "del" | "erase" | "rd" | "rmdir"
                ) && !words.iter().any(|arg| arg == "/?")
            })
        });
    }
    is_powershell_deletion_name(&name) && !args.is_empty()
}

fn executable_name(program: &str, platform: DangerousCommandPlatform) -> String {
    match platform {
        DangerousCommandPlatform::Posix => {
            program.rsplit('/').next().unwrap_or(program).to_string()
        }
        DangerousCommandPlatform::Windows => program
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(program)
            .to_ascii_lowercase()
            .trim_end_matches(".exe")
            .to_string(),
    }
}

fn is_powershell_deletion_name(name: &str) -> bool {
    // A module-qualified cmdlet has the same deletion semantics.
    let name = name
        .rsplit('\\')
        .next()
        .unwrap_or(name)
        .to_ascii_lowercase();
    matches!(
        name.as_str(),
        "remove-item" | "ri" | "rm" | "del" | "erase" | "rd" | "rmdir"
    )
}

fn powershell_script_deletes(script: &str) -> bool {
    let mut parser = tree_sitter::Parser::new();
    if parser
        .set_language(&tree_sitter_powershell::LANGUAGE.into())
        .is_err()
    {
        return false;
    }
    let Some(tree) = parser.parse(script, None) else {
        return false;
    };
    fn visit(node: tree_sitter::Node<'_>, source: &str) -> bool {
        if node.kind() == "command_name"
            && let Ok(name) = node.utf8_text(source.as_bytes())
            && is_powershell_deletion_name(name.trim_matches(['\'', '"']))
        {
            return true;
        }
        let mut cursor = node.walk();
        node.named_children(&mut cursor)
            .any(|child| visit(child, source))
    }
    visit(tree.root_node(), script)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(command: &[&str]) -> Vec<String> {
        command.iter().map(|word| word.to_string()).collect()
    }

    #[test]
    fn deletion_classification_posix() {
        for command in [
            vec!["rm", "file"],
            vec!["rm", "-r", "dir"],
            vec!["rm", "--", "--help"],
            vec!["find", ".", "-delete"],
            vec!["find", ".", "-exec", "rm", "{}", ";"],
            vec!["unlink", "file"],
            vec!["rmdir", "dir"],
            vec!["bash", "-lc", "echo ready; rm -- file"],
            vec!["bash", "-lc", "for f in a b; do rm \"$f\"; done"],
            vec!["sudo", "rm", "file"],
            vec!["env", "X=1", "rm", "file"],
        ] {
            assert!(
                is_deletion_command(&words(&command), DangerousCommandPlatform::Posix),
                "{command:?}"
            );
        }
        for command in [
            vec!["echo", "rm file"],
            vec!["rm", "--help"],
            vec!["git", "reset", "--hard"],
            vec!["node", "script.js"],
            vec!["cargo", "test"],
        ] {
            assert!(
                !is_deletion_command(&words(&command), DangerousCommandPlatform::Posix),
                "{command:?}"
            );
        }
    }

    #[test]
    fn deletion_classification_windows() {
        for command in [
            vec![
                "powershell.exe",
                "-Command",
                "Remove-Item -LiteralPath $target -Recurse",
            ],
            vec!["pwsh", "-Command", "if ($true) { ri 'file' }"],
            vec![
                "pwsh",
                "-Command",
                "Microsoft.PowerShell.Management\\Remove-Item file",
            ],
            vec!["cmd.exe", "/c", "echo ready&del file"],
            vec!["cmd", "/c", "rmdir dir"],
            vec!["Remove-Item", "file"],
        ] {
            assert!(
                is_deletion_command(&words(&command), DangerousCommandPlatform::Windows),
                "{command:?}"
            );
        }
        for command in [
            vec!["pwsh", "-Command", "Write-Host 'Remove-Item file'"],
            vec!["cmd", "/c", "echo del file"],
            vec!["cmd", "/c", "del /?"],
            vec!["Get-ChildItem", "-Force"],
        ] {
            assert!(
                !is_deletion_command(&words(&command), DangerousCommandPlatform::Windows),
                "{command:?}"
            );
        }
    }
}
