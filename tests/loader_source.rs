//! Source checks for `assets/react-islands.js`. The browser tests in
//! `js-tests/` check the behavior. These checks keep the CSP and safety
//! rules in the file.

const LOADER: &str = include_str!("../assets/react-islands.js");

/// The file text without whole-line `//` comments. A `//` inside a
/// line can be part of a string, so the check keeps those lines.
fn code() -> String {
    LOADER
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn uses_no_eval_or_html_strings() {
    let code = code();
    for banned in [
        "eval(",
        "Function(",
        "innerHTML",
        "outerHTML",
        "insertAdjacentHTML",
        "document.write",
        "srcdoc",
        "DOMParser",
        "createContextualFragment",
        "setHTMLUnsafe",
        "parseHTMLUnsafe",
        "import(",
    ] {
        assert!(!code.contains(banned), "react-islands.js uses {banned}");
    }
}

#[test]
fn timers_get_functions_not_strings() {
    let code = code();
    for (i, _) in code.match_indices("setTimeout(") {
        let argument = code[i + "setTimeout(".len()..].trim_start();
        assert!(
            argument.starts_with("run"),
            "setTimeout gets a function: {}",
            &code[i..i + 40]
        );
    }
}

#[test]
fn is_strict_and_wrapped() {
    let code = code();
    assert!(code.contains("'use strict';"), "strict mode");
    assert!(code.trim_start().starts_with("(function"), "an IIFE");
}

#[test]
fn keeps_the_registry_in_a_map() {
    let code = code();
    assert!(code.contains("new Map()"), "the registry is a Map");
    assert!(
        code.contains("hasOwnProperty"),
        "copies own properties only"
    );
}

#[test]
fn names_the_public_contract() {
    let code = code();
    for name in [
        "autumnReact",
        "data-react-island",
        "data-react-props",
        "data-react-mount",
        "data-react-state",
        "data-react-ignore",
        "autumn:react:",
        "autumn:react:props",
        "identifierPrefix",
        "onUncaughtError",
        "MutationObserver",
    ] {
        assert!(code.contains(name), "react-islands.js names {name}");
    }
}
