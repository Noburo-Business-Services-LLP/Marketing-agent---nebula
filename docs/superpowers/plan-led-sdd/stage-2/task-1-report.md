# Task 1 report
Status: DONE. Commit: 684c764. Tests: new 7 pass; full backend suite 1342 pass, 0 fail.
Files: backend/services/week/weekMath.js, weekProposal.js; tests weekMath.test.js, weekProposal.test.js.
Test change: the pool-130 comment/assertion text was wrong (said 6 posts). By hand: mixed() has 5 posts, 1 carousel, 2 reels (cap 2) = 55+60+322 = 437; removing both videos gives 115 <= 130. So carousels 1, posts 5, removed.videos 2. I corrected the message and added posts===5 and removed.videos===2 asserts. Removal order and never-over-pool invariant unchanged.
Choices: videos over the cadence cap are dropped (not counted in removed); calendar item channel = item.platform or null; plan items channel null; ids reindexed after removal.
