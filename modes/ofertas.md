# Mode: ofertas — Multi-Offer Comparison

**Required context:** Before executing, ensure you have loaded `modes/_shared.md` AND `modes/_eval.md`. This mode applies the scoring system and archetype-aware comparisons defined in `_eval.md`.

Scoring matrix across 10 weighted dimensions:

| Dimension | Weight | Criteria 1-5 |
|-----------|--------|---------------|
| North Star Alignment | 25% | 5=exact target role, 1=unrelated |
| CV Match | 15% | 5=90%+ match, 1=<40% match |
| Level (senior+) | 15% | 5=staff+, 4=senior, 3=mid-senior, 2=mid, 1=junior |
| Estimated Comp | 10% | 5=top quartile, 1=below market |
| Growth Trajectory | 10% | 5=clear path to next level, 1=dead end |
| Remote Quality | 5% | 5=full remote async, 1=onsite only |
| Company Reputation | 5% | 5=top employer, 1=red flags |
| Tech Stack Modernity | 5% | 5=cutting edge AI/ML, 1=legacy |
| Speed to Offer | 5% | 5=fast process, 1=6+ months |
| Cultural Signals | 5% | 5=builder culture, 1=bureaucratic |

For each offer: score on every dimension, total weighted score.
Final ranking + recommendation with time-to-offer considerations.

Ask the user for the offers if they are not in context. They can be text, URLs, or references to offers already evaluated in the tracker.
