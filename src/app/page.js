import Dashboard from '@/components/Dashboard';

export default function Home() {
  const user = { name: 'Eva' };
  return <Dashboard user={user} />;
}