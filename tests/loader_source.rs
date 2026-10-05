//! Source checks for `assets/react-islands.js`. The browser tests in
//! `js-tests/` check the behavior. These checks keep the CSP and safety
//! rules in the file.

const LOADER: &str = include_str!("../assets/react-islands.js");

/// The file text without `//` line comments.
fn code() -> String {
    LOADER
        .lines()
        .map(|line| line.split_once("//").map_or(line, |(code, _)| code))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn uses_no_eval_or_html_strings() {
    let code = code();
    for banned in [
        "eval(",
        "new Function",
        "innerHTML",
        "outerHTML",
        "insertAdjacentHTML",
        "document.write",
        "setTimeout('",
        "setTimeout(\"",
    ] {
        assert!(!code.contains(banned), "react-islands.js uses {banned}");
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
        "identifierPrefix",
        "onUncaughtError",
        "MutationObserver",
    ] {
        assert!(code.contains(name), "react-islands.js names {name}");
    }
}
