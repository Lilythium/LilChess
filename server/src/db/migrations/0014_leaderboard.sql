-- Leaderboard (v2 phase 6): "most improved / most active" scan one variant over a time window.
CREATE INDEX idx_rating_history_variant_created ON rating_history(variant, created_at);