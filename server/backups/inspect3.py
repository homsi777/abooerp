import zlib
import re

with open(r'c:\Users\Homsi\Desktop\almiya-hsahin\server\backups\BKP-20260606174649-9570.dump', 'rb') as f:
    data = f.read()

# The daily_ledger_rows COPY statement header was found at offset ~91248 in raw binary
# Let me find the actual data blob near that area
# In pg_dump custom format, data is stored after the TOC

# First let's find ALL decompressible blocks and their content patterns
print("Searching for blocks near the COPY daily_ledger_rows reference...")
print()

# Search in a wider range around where we know the reference is
all_blocks = []
i = 0
while i < len(data) - 2:
    for wbits in [-15, 15, 31, 47]:
        try:
            d = zlib.decompress(data[i:], wbits)
            if len(d) > 100:
                all_blocks.append((i, len(d), d))
                i += 2
                break
        except:
            pass
    else:
        i += 1

print(f"Total blocks: {len(all_blocks)}")

# Now search for blocks that have the session UUID we found earlier
# or that have receipt numbers or Arabic destination names
target_session = b'088938ae-40f7-4f65-b651-7551f280969d'
target_session2 = b'9531e90b-8d20-41a8-a84c-c578a1c257c1'

for offset, size, d in all_blocks:
    if target_session in d or target_session2 in d:
        text = d.decode('utf-8', errors='replace')
        lines = text.strip().split('\n')
        print(f"\nBlock at {offset} ({size} bytes, {len(lines)} lines) contains session UUID")
        # Show structure
        for line in lines[:3]:
            cols = line.split('\t')
            print(f"  {len(cols)} cols: {cols[0][:20]}... | {cols[1][:20] if len(cols)>1 else ''}")

# Alternative: search for any block that has many lines with numeric values in positions
# that would match ledger row amounts (positions 10-14 for amounts)
print("\n--- Looking for blocks with amount-like numeric patterns ---")
for offset, size, d in all_blocks:
    text = d.decode('utf-8', errors='replace')
    lines = text.strip().split('\n')
    # Check if lines have a pattern: UUID\tsomething\tnumber\t...\tnumber.number\tnumber.number
    amount_lines = 0
    for line in lines:
        cols = line.split('\t')
        if len(cols) >= 14:
            # Check if columns 10-13 look like amounts (numbers with decimals)
            try:
                amounts = [cols[i] for i in range(10, min(14, len(cols)))]
                numeric_count = sum(1 for a in amounts if re.match(r'^-?\d+(\.\d+)?$', a.strip()))
                if numeric_count >= 2:
                    amount_lines += 1
            except:
                pass
    if amount_lines >= 5:
        print(f"  Block at {offset}: {amount_lines} lines with amount patterns ({len(lines)} total lines)")
        # Show samples
        for line in lines[:3]:
            cols = line.split('\t')
            print(f"    {len(cols)} cols: {' | '.join(c[:12] for c in cols[:15])}")

# Final: just show ALL blocks with their line count and column count
print("\n--- All blocks summary ---")
for offset, size, d in sorted(all_blocks, key=lambda x: x[0]):
    text = d.decode('utf-8', errors='replace')
    lines = text.strip().split('\n')
    if lines:
        cols = lines[0].split('\t')
        if len(cols) >= 10 and len(lines) >= 5:
            print(f"  Offset {offset}: {len(lines)} lines x {len(cols)} cols ({size} bytes)")
