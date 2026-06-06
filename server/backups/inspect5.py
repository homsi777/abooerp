import zlib
import re
from collections import Counter

with open(r'c:\Users\Homsi\Desktop\almiya-hsahin\server\backups\BKP-20260606174649-9570.dump', 'rb') as f:
    data = f.read()

print(f"Dump file size: {len(data)} bytes ({len(data)/1024:.1f} KB)")

# Decompress ALL blocks with all wbits options, deduplicate by content
seen_content = set()
all_texts = []

i = 0
while i < len(data) - 2:
    for wbits in [-15, 15, 31, 47]:
        try:
            d = zlib.decompress(data[i:], wbits)
            if len(d) > 30:
                h = hash(d)
                if h not in seen_content:
                    seen_content.add(h)
                    all_texts.append(d.decode('utf-8', errors='replace'))
            i += 2
            break
        except:
            pass
    else:
        i += 1

combined = '\n'.join(all_texts)
all_lines = [l for l in combined.split('\n') if l.strip() and l != '\\.']
print(f"Unique decompressed blocks: {len(all_texts)}")
print(f"Total text: {len(combined)} chars")
print(f"Non-empty lines: {len(all_lines)}")

# Column count distribution
col_counts = Counter()
for line in all_lines:
    cols = line.split('\t')
    if len(cols) >= 3:
        col_counts[len(cols)] += 1

print("\nColumn count distribution:")
for count, num in sorted(col_counts.items()):
    print(f"  {count} cols: {num} lines")

# Check specific column counts that could be daily_ledger_rows (25 cols)
print("\n--- Checking for daily_ledger_rows (expected ~25 columns) ---")
for target in range(22, 28):
    matching = [l for l in all_lines if len(l.split('\t')) == target]
    if matching:
        cols = matching[0].split('\t')
        # Check if 3rd col is numeric (row_no)
        third_numeric = cols[2].strip().isdigit() if len(cols) > 2 else False
        print(f"  {target} cols: {len(matching)} lines, 3rd col numeric: {third_numeric}")
        if third_numeric:
            print(f"    Sample: row_no={cols[2]}, col3={cols[3][:15]}, col4={cols[4][:15]}")

# Show shipments (50 cols)
print("\n--- Shipments (50 cols) ---")
shipments = [l for l in all_lines if len(l.split('\t')) == 50]
print(f"  Found {len(shipments)} shipment rows")
if shipments:
    cols = shipments[0].split('\t')
    print(f"  Sample shipment_no={cols[2][:10]}")

# Show what's in 19-col block (sessions?)
print("\n--- 19-col block (daily_ledger_sessions?) ---")
sessions = [l for l in all_lines if len(l.split('\t')) == 19]
print(f"  Found {len(sessions)} rows")
if sessions:
    for s in sessions[:3]:
        cols = s.split('\t')
        # sessions: id, company_id, branch_id, ledger_date, line_label, origin_label...
        print(f"  id={cols[0][:8]}... date?={cols[3][:12]} line?={cols[4][:20]}")

print("\n--- Summary ---")
total_data_lines = sum(col_counts.values())
print(f"Total data lines in backup: {total_data_lines}")
print(f"This backup was only {len(data)/1024:.0f}KB - it may be a partial/schema-only backup")
