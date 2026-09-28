## 2025-05-18 - Fast Hex Hamming Distance Computation
**Learning:** Computing Hamming distance between hex strings using `parseInt(x[i], 16)` and bit-shifting loops in JS introduces significant overhead in pairwise comparison loops ($O(N^2)$). Precomputing 4-bit popcount and ASCII character nibble mapping tables yields an ~11x speedup while preserving exact equality and boundary behavior.
**Action:** Use precomputed lookup tables (`POPCOUNT_4BIT` and `HEX_VAL`) when performing bitwise comparisons or popcounts on hex string representations in performance-critical inner loops.
