import { type NetworkMode } from '../../../lib/settings/systemNetworkStore';

interface NetworkModeCardProps {
  value: NetworkMode;
  onChange: (mode: NetworkMode) => void;
}

const modeDescriptions: Record<NetworkMode, string> = {
  local_only: 'تشغيل محلي بالكامل على جهاز أو فرع واحد بدون مشاركة خارجية.',
  lan_branch: 'تشغيل عبر شبكة داخلية بين أجهزة الفرع والفروع المتصلة على نفس LAN/VPN.',
  cloud_ready: 'جاهزية ربط سحابي مع نقاط تشغيل بعيدة وتزامن خدمات مستقبلية.',
  hybrid_ready: 'نمط مختلط يجمع بين العمل المحلي وربط الفروع/الخدمات عن بعد.',
};

export default function NetworkModeCard({ value, onChange }: NetworkModeCardProps) {
  return (
    <div className="card">
      <div className="card-header">تهيئة نمط الشبكة</div>
      <div className="grid grid-cols-4 gap-2">
        <button className={`toolbar-btn ${value === 'local_only' ? 'primary' : ''}`} onClick={() => onChange('local_only')}>محلي فقط</button>
        <button className={`toolbar-btn ${value === 'lan_branch' ? 'primary' : ''}`} onClick={() => onChange('lan_branch')}>شبكة داخلية / فرع</button>
        <button className={`toolbar-btn ${value === 'cloud_ready' ? 'primary' : ''}`} onClick={() => onChange('cloud_ready')}>جاهز للسحابة</button>
        <button className={`toolbar-btn ${value === 'hybrid_ready' ? 'primary' : ''}`} onClick={() => onChange('hybrid_ready')}>نمط مختلط</button>
      </div>
      <div className="text-sm text-gray-600 mt-3">{modeDescriptions[value]}</div>
    </div>
  );
}
