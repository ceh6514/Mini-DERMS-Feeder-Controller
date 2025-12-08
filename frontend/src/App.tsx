import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import { useAuth } from './auth/AuthProvider';

const App = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading">Loading…</div>;
  }

  if (!user) {
    return <Login />;
  }

  return <Dashboard />;
};

export default App;
