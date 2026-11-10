// SPDX-License-Identifier: AGPL-3.0-only
//! Frame timing for `--bench`: the gaps between consecutive renders while the
//! message list scrolls by itself.

use std::time::{Duration, Instant};

#[derive(Default)]
pub struct ScrollBench {
    last_frame: Option<Instant>,
    gaps: Vec<Duration>,
    pub steps: u32,
}

impl ScrollBench {
    pub fn frame(&mut self) {
        let now = Instant::now();
        if let Some(last) = self.last_frame.replace(now) {
            self.gaps.push(now - last);
        }
    }

    pub fn summary(&self) -> String {
        let mut ms: Vec<f64> = self.gaps.iter().map(|gap| gap.as_secs_f64() * 1000.0).collect();
        if ms.is_empty() {
            return "frames=0".into();
        }
        ms.sort_by(f64::total_cmp);
        let average = ms.iter().sum::<f64>() / ms.len() as f64;
        let p95 = ms[((ms.len() as f64 * 0.95) as usize).min(ms.len() - 1)];
        let over_16 = ms.iter().filter(|gap| **gap > 16.7).count();
        format!(
            "frames={} steps={} avg_ms={average:.2} p95_ms={p95:.2} max_ms={:.2} over_16_7ms={over_16}",
            ms.len() + 1,
            self.steps,
            ms[ms.len() - 1]
        )
    }
}
