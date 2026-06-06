import zlib
import re
import sys

with open(r'c:\Users\Homsi\Desktop\almiya-hsahin\server\backups\BKP-20260606174649-9570.dump', 'rb') as f:
    data = f.read()

print(f"Dump file size: {len(data)} bytes")
print()

# Extract block at 302375 (5 lines x 19 cols - could be daily_ledger_sessions)
d = zlib.decompress(data[302375:], -15)
text = d.decode('utf-8', errors='replace')
lines = text.strip().split('\n')
print(f"Block 302375: {len(lines)} lines x {len(lines[0].split(chr(9)))} cols")
print("  This might be daily_ledger_sessions:")
for line in lines[:5]:
    cols = line.split('\t')
    print(f"  id={cols[0][:8]}... line_label?={cols[4][:20] if len(cols)>4 else '?'}")
print()

# Now let me look for the daily_ledger_rows data by searching for receipt patterns
# Receipt numbers are usually like "9390" or similar
# Let me search the ENTIRE binary for patterns of tab-separated data with 25+ columns

# Strategy: find ALL decompressed text, combine, and search for 25-column rows
all_text = ""
i = 0
seen_offsets = set()
while i < len(data) - 2:
    if i in seen_offsets:
        i += 1
        continue
    for wbits in [-15]:
        try:
            d = zlib.decompress(data[i:], wbits)
            if len(d) > 50:
                text = d.decode('utf-8', errors='replace')
                all_text += text + "\n"
                seen_offsets.add(i)
                seen_offsets.add(i+1)
                seen_offsets.add(i+2)
            break
        except:
            pass
    i += 1

# Now search for rows with exactly 24-26 columns (daily_ledger_rows range)
all_lines = all_text.split('\n')
candidates = []
for line in all_lines:
    cols = line.split('\t')
    if 23 <= len(cols) <= 27:
        candidates.append(line)

print(f"Lines with 23-27 columns: {len(candidates)}")
if candidates:
    # Show column count distribution
    from collections import Counter
    col_counts = Counter(len(l.split('\t')) for l in candidates)
    print(f"  Column count distribution: {dict(col_counts)}")
    # Show first few
    for c in candidates[:3]:
        cols = c.split('\t')
        print(f"  {len(cols)} cols: id={cols[0][:8]}... session?={cols[1][:8]}... col2={cols[2][:10]} col3={cols[3][:10]} col4={cols[4][:10]}")
else:
    # The data might not be in this backup! Let's check what tables DO have data
    print("\nNo 25-column rows found. Let's check what data exists:")
    print(f"Total decompressed text: {len(all_text)} chars")
    print(f"Total lines: {len(all_lines)}")
    
    # Group by column count
    from collections import Counter
    col_counts = Counter()
    for line in all_lines:
        if line.strip() and line != '\\.' and not line.startswith('--'):
            cols = line.split('\t')
            if len(cols) >= 3:
                col_counts[len(cols)] += 1
    
    print("\nColumn count distribution (lines with 3+ cols):")
    for count, num in sorted(col_counts.items()):
        print(f"  {count} cols: {num} lines")

# Also: let's count total lines with UUID pattern in first column
uuid_first = [l for l in all_lines if re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}', l)]
print(f"\nTotal lines starting with UUID: {len(uuid_first)}")
