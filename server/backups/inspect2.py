import zlib
import re

with open(r'c:\Users\Homsi\Desktop\almiya-hsahin\server\backups\BKP-20260606174649-9570.dump', 'rb') as f:
    data = f.read()

# Decompress the block at 333534 with correct wbits
for wbits in [15, -15, 31, 47]:
    try:
        d = zlib.decompress(data[333534:], wbits)
        text = d.decode('utf-8', errors='replace')
        lines = text.strip().split('\n')
        print(f'Block 333534 (wbits={wbits}): {len(lines)} lines, {len(d)} bytes')
        
        # Check columns
        first_cols = lines[0].split('\t')
        print(f'  Columns: {len(first_cols)}')
        
        # Look for ledger row pattern
        ledger = [l for l in lines if re.match(r'[0-9a-f-]{36}\t[0-9a-f-]{36}\t\d+\t', l)]
        print(f'  Ledger-like rows: {len(ledger)}')
        
        # Show sample
        if ledger:
            for row in ledger[:3]:
                cols = row.split('\t')
                print(f'    row_no={cols[2]}, receipt={cols[3][:20]}, dest={cols[4][:20] if len(cols)>4 else "?"}')
        else:
            # Show what data IS there
            for row in lines[:3]:
                cols = row.split('\t')
                snippet = '\t'.join(c[:15] for c in cols[:8])
                print(f'    Sample: {snippet}')
        break
    except Exception as e:
        continue

# Now let's look at block 353296 (senders_receivers likely)
print()
for wbits in [15, -15, 31, 47]:
    try:
        d = zlib.decompress(data[353296:], wbits)
        text = d.decode('utf-8', errors='replace')
        lines = text.strip().split('\n')
        print(f'Block 353296 (wbits={wbits}): {len(lines)} lines')
        first_cols = lines[0].split('\t')
        print(f'  Columns: {len(first_cols)}')
        # Sample
        for row in lines[:2]:
            cols = row.split('\t')
            snippet = '\t'.join(c[:15] for c in cols[:6])
            print(f'    Sample: {snippet}')
        break
    except:
        continue

# Let's find ALL blocks and check each one for ledger rows
print('\n--- Scanning ALL blocks for daily_ledger_rows ---')
i = 0
total_ledger_rows = 0
all_ledger_lines = []
while i < len(data) - 2:
    for wbits in [15, -15, 31, 47]:
        try:
            d = zlib.decompress(data[i:], wbits)
            if len(d) > 20:
                text = d.decode('utf-8', errors='replace')
                lines = text.strip().split('\n')
                ledger = [l for l in lines if re.match(r'[0-9a-f-]{36}\t[0-9a-f-]{36}\t\d+\t', l)]
                if ledger:
                    # Check if it has the right number of columns for ledger_rows (~25 cols)
                    for row in ledger:
                        cols = row.split('\t')
                        if 20 <= len(cols) <= 30:
                            all_ledger_lines.append(row)
                i += 2
                break
        except:
            pass
    else:
        i += 1

print(f'Total ledger-like rows (20-30 cols): {len(all_ledger_lines)}')
if all_ledger_lines:
    # Deduplicate
    unique = list(set(all_ledger_lines))
    print(f'Unique rows: {len(unique)}')
    
    # Count those with data
    with_receipt = 0
    with_dest = 0
    with_sender = 0
    for row in unique:
        cols = row.split('\t')
        if cols[3] != '\\N' and cols[3].strip():
            with_receipt += 1
        if len(cols) > 4 and cols[4] != '\\N' and cols[4].strip():
            with_dest += 1
        if len(cols) > 8 and cols[8] != '\\N' and cols[8].strip():
            with_sender += 1
    
    print(f'  With receipt_no: {with_receipt}')
    print(f'  With destination: {with_dest}')
    print(f'  With sender_name: {with_sender}')
    
    # Show some samples
    print('\nSample rows:')
    for row in unique[:5]:
        cols = row.split('\t')
        print(f'  row_no={cols[2]}, receipt={cols[3][:15]}, dest={cols[4][:20] if len(cols)>4 else "?"}, sender={cols[8][:15] if len(cols)>8 else "?"}')
