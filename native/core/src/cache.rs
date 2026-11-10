// SPDX-License-Identifier: AGPL-3.0-only
//! Local cache: the last known state as one JSON file, so a screen can draw
//! before the live stream answers.

use std::fs;
use std::io;
use std::path::Path;

use crate::model::State;

pub fn save(path: &Path, state: &State) -> io::Result<()> {
    let json = serde_json::to_vec(state).map_err(io::Error::other)?;
    let partial = path.with_extension("partial");
    fs::write(&partial, json)?;
    fs::rename(partial, path)
}

/// `Ok(None)` when there is no cache yet.
pub fn load(path: &Path) -> io::Result<Option<State>> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}
