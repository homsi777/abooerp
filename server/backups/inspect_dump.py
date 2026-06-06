import zlib
import re

with open(r'c:\Users\Homsi\Desktop\almiya-hsahin\server\backups\BKP-20260606174649-9570.dump', 'rb') as f:
    data = f.read()

all_decompressed = []
i = 0
while i < len(data) - 2:
    if data[i] == 0x78:
        try:
            d = zlib.decompress(data[i:], 15)
            if len(d) > 50:
                all_decompressed.append((i, d))
            skip = len(d) // 2 if len(d) > 100 else 1
            i += max(skip, 1)
            continue
        except:
            pass
    i += 1

print(f'Found {len(all_decompressed)} decompressed blocks')
total_bytes = sum(len(d) for _, d in all_decompressed)
print(f'Total decompressed: {total_bytes} bytes')

combined = b''
for _, d in all_decompressed:
    combined += d

text = combined.decode('utf-8', errors='replace')
lines = text.split('\n')
print(f'Total lines: {len(lines)}')

tab_lines = [l for l in lines if l.count('\t') >= 15]
print(f'Lines with 15+ tabs: {len(tab_lines)}')

row_pattern = [l for l in lines if re.match(r'[0-9a-f-]{36}\t[0-9a-f-]{36}\t\d+\t', l)]
print(f'\nLines with UUID-UUID-number pattern (likely ledger rows): {len(row_pattern)}')

if row_pattern:
    print('\nFirst 5:')
    for line in row_pattern[:5]:
        cols = line.split('\t')
        dest = cols[4][:30] if len(cols) > 4 else '?'
        print(f'  row_no={cols[2]}, receipt={cols[3]}, dest={dest}')
    print('\nLast 5:')
    for line in row_pattern[-5:]:
        cols = line.split('\t')
        dest = cols[4][:30] if len(cols) > 4 else '?'
        print(f'  row_no={cols[2]}, receipt={cols[3]}, dest={dest}')

    # Count unique session IDs (2nd column)
    sessions = set(line.split('\t')[1] for line in row_pattern)
    print(f'\nUnique session IDs: {len(sessions)}')
    for sid in sessions:
        count = sum(1 for l in row_pattern if l.split('\t')[1] == sid)
        print(f'  Session {sid[:8]}...: {count} rows')

    # Count rows with actual data (receipt or destination not null/empty)
    with_data = [l for l in row_pattern if l.split('\t')[3] != '\\N' or (len(l.split('\t')) > 4 and l.split('\t')[4] != '\\N' and l.split('\t')[4] != '')]
    print(f'\nRows with receipt OR destination: {len(with_data)}')
