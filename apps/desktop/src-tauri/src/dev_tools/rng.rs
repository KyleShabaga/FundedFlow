//! A small deterministic generator (SplitMix64) for synthetic data. Not for
//! anything security-related: the same seed always yields the same sequence on
//! every platform, which is the point.

pub struct Rng(u64);

impl Rng {
    #[cfg(test)]
    pub fn new(seed: u64) -> Self {
        Rng(seed)
    }

    /// A generator for one named stream of a seed, independent of the order in
    /// which other streams are used (a scenario seeded alone matches the same
    /// scenario inside a preset).
    pub fn stream(seed: u64, name: &str) -> Self {
        // FNV-1a of the name, mixed with the seed.
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for b in name.bytes() {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
        Rng(seed ^ h.rotate_left(17))
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// Uniform in `lo..=hi`.
    pub fn range(&mut self, lo: i64, hi: i64) -> i64 {
        debug_assert!(lo <= hi);
        let span = (hi - lo) as u64 + 1;
        lo + (self.next_u64() % span) as i64
    }

    /// True with probability `percent` / 100.
    pub fn chance(&mut self, percent: i64) -> bool {
        self.range(0, 99) < percent
    }

    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.range(0, items.len() as i64 - 1) as usize]
    }

    /// An item chosen by integer weight.
    pub fn weighted<'a, T>(&mut self, items: &'a [(T, i64)]) -> &'a T {
        let total: i64 = items.iter().map(|(_, w)| w).sum();
        let mut roll = self.range(0, total - 1);
        for (item, w) in items {
            if roll < *w {
                return item;
            }
            roll -= w;
        }
        &items[items.len() - 1].0
    }
}

#[cfg(test)]
mod tests {
    use super::Rng;

    #[test]
    fn same_seed_same_sequence_and_streams_are_independent() {
        let a: Vec<u64> = (0..5)
            .map({
                let mut r = Rng::stream(7, "x");
                move |_| r.next_u64()
            })
            .collect();
        let b: Vec<u64> = (0..5)
            .map({
                let mut r = Rng::stream(7, "x");
                move |_| r.next_u64()
            })
            .collect();
        let c: Vec<u64> = (0..5)
            .map({
                let mut r = Rng::stream(7, "y");
                move |_| r.next_u64()
            })
            .collect();
        assert_eq!(a, b);
        assert_ne!(a, c);
        let mut r = Rng::new(1);
        for _ in 0..1000 {
            let v = r.range(-3, 3);
            assert!((-3..=3).contains(&v));
        }
    }
}
