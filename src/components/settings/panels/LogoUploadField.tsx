import { ImagePlus, UserCircle2 } from 'lucide-react';

interface LogoUploadFieldProps {
  value: string;
  onChange: (dataUrl: string) => void;
}

export default function LogoUploadField({ value, onChange }: LogoUploadFieldProps) {
  const handleFileChange = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-2">
      <label className="form-label">شعار الشركة</label>
      <div className="flex items-center gap-4">
        <div
          className="w-20 h-20 rounded border border-gray-200 flex items-center justify-center bg-gray-50 overflow-hidden"
          aria-label="company-logo-preview"
        >
          {value ? <img src={value} alt="logo" className="w-full h-full object-cover" /> : <UserCircle2 size={42} className="text-gray-400" />}
        </div>
        <div className="flex gap-2">
          <label className="toolbar-btn flex items-center gap-1 cursor-pointer">
            <ImagePlus size={14} />
            رفع شعار
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => handleFileChange(e.target.files?.[0])}
            />
          </label>
          <button type="button" className="toolbar-btn" onClick={() => onChange('')}>
            إزالة
          </button>
        </div>
      </div>
    </div>
  );
}
