'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export default function GroupFilter({ groups }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get('group') || 'ALL';

  return (
    <select
      className="select"
      defaultValue={current}
      onChange={(e) => {
        const value = e.target.value;
        router.push(value === 'ALL' ? '/' : `/?group=${encodeURIComponent(value)}`);
      }}
    >
      <option value="ALL">全部分类</option>
      {groups.map((g) => (
        <option key={g.id} value={g.name}>{g.name}</option>
      ))}
    </select>
  );
}
