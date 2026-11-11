import { useState } from 'react';
import { useAuth } from '../../auth.jsx';
import { api } from '../../api.js';
import ImageUpload from '../../components/ImageUpload.jsx';
import { Avatar, Badge, Btn, Card, ErrorBox, Field, Input, Notice, PageHeader, Select, useAction } from '../../components/ui.jsx';

const FIELDS = {
  farmer: [['farm_name', 'Farm name'], ['location_text', 'Farm location']],
  buyer: [['buyer_type', 'Buyer type', 'select'], ['org_name', 'Business name'], ['business_type', 'Business type (e.g. cafe, hotel, retailer)'], ['address', 'Business address'], ['payment_preference', 'Preferred payment method']],
  feed_supplier: [['business_name', 'Business name'], ['address', 'Address']],
  transporter: [['company_name', 'Company'], ['vehicle_type', 'Vehicle type'], ['plate_number', 'Plate number'], ['capacity_litres', 'Capacity (litres)', 'number'], ['service_area', 'Service area'], ['has_cold_storage', 'Cold storage', 'bool'], ['available', 'Available for new deliveries', 'bool']],
};

export default function Profile() {
  const { user, refresh } = useAuth();
  const [base, setBase] = useState({ full_name: user.full_name, phone: user.phone || '', region: user.region || '', woreda: user.woreda || '' });
  const [prof, setProf] = useState(() => Object.fromEntries((FIELDS[user.role] || []).map(([k]) => [k, user.profile?.[k] ?? ''])));
  const [saved, setSaved] = useState(false);
  const [avatar, setAvatar] = useState(user.avatar_url || '');
  const [inApp, setInApp] = useState(user.notification_prefs?.in_app !== false);
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [pwMsg, setPwMsg] = useState('');
  const pwAct = useAction();
  const { busy, error, run } = useAction();
  const changePw = (e) => { e.preventDefault(); setPwMsg(''); pwAct.run(async () => { await api.post('/auth/change-password', pw); setPw({ current_password: '', new_password: '' }); setPwMsg('Password changed.'); }); };

  const submit = (e) => {
    e.preventDefault(); setSaved(false);
    const profile = {};
    for (const [k, , type] of FIELDS[user.role] || []) {
      const v = prof[k];
      if (type === 'bool') profile[k] = !!v;
      else if (v !== '' && v !== null && v !== undefined) profile[k] = type === 'number' ? Number(v) : v;
    }
    run(async () => {
      await api.patch('/auth/me', { ...(avatar ? { avatar_url: avatar } : {}), notification_prefs: { in_app: inApp }, full_name: base.full_name, phone: base.phone || undefined, region: base.region || undefined, woreda: base.woreda || undefined, ...(Object.keys(profile).length ? { profile } : {}) });
      await refresh(); setSaved(true);
    });
  };
  return (
    <>
      <PageHeader title="My profile" subtitle={user.email} actions={user.fayda_verified ? <Badge tone="green">Fayda ID verified</Badge> : <Badge>Fayda ID not verified</Badge>} />
      <form onSubmit={submit} className="space-y-4">
        <Card title="Photo">
          <div className="flex items-center gap-4"><Avatar url={avatar} name={user.full_name} size={56} /><ImageUpload label="photo" value={avatar} onChange={setAvatar} /></div>
        </Card>
        <Card title="Account">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Full name"><Input required value={base.full_name} onChange={(e) => setBase({ ...base, full_name: e.target.value })} /></Field>
            <Field label="Phone" hint="Farmers: used to recognise you on the USSD service"><Input value={base.phone} onChange={(e) => setBase({ ...base, phone: e.target.value })} /></Field>
            <Field label="Region"><Input value={base.region} onChange={(e) => setBase({ ...base, region: e.target.value })} /></Field>
            <Field label="Woreda / town"><Input value={base.woreda} onChange={(e) => setBase({ ...base, woreda: e.target.value })} /></Field>
          </div>
        </Card>
        {FIELDS[user.role] && (
          <Card title="Business details">
            <div className="grid gap-3 md:grid-cols-2">
              {FIELDS[user.role].map(([k, label, type]) => (
                <Field key={k} label={label}>
                  {type === 'bool' ? <Select value={prof[k] ? 'yes' : 'no'} onChange={(e) => setProf({ ...prof, [k]: e.target.value === 'yes' })}><option value="yes">Yes</option><option value="no">No</option></Select>
                    : type === 'select' ? <Select value={prof[k] || 'individual'} onChange={(e) => setProf({ ...prof, [k]: e.target.value })}><option value="individual">Individual</option><option value="processor">Dairy processor</option><option value="collection_centre">Milk collection centre</option></Select>
                      : <Input type={type === 'number' ? 'number' : 'text'} value={prof[k] ?? ''} onChange={(e) => setProf({ ...prof, [k]: e.target.value })} />}
                </Field>
              ))}
            </div>
          </Card>
        )}
        <Card title="Notifications">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inApp} onChange={(e) => setInApp(e.target.checked)} />Show order, payment and delivery updates in the app</label>
        </Card>
        <ErrorBox>{error}</ErrorBox>
        {saved && <Notice>Profile saved.</Notice>}
        <Btn type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</Btn>
      </form>
      <form onSubmit={changePw} className="mt-6 max-w-md">
        <Card title="Change password">
          <div className="space-y-3">
            <Field label="Current password"><Input type="password" required autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
            <Field label="New password" hint="At least 8 characters with a letter and a digit"><Input type="password" required minLength={8} autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
            <ErrorBox>{pwAct.error}</ErrorBox>{pwMsg && <Notice>{pwMsg}</Notice>}
            <Btn type="submit" disabled={pwAct.busy}>Change password</Btn>
          </div>
        </Card>
      </form>
    </>
  );
}
