import { useState } from "react";
import Dashboard from "./pages/Dashboard.tsx";
import Login from "./pages/Login";
import "./index.css";
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(
    !!localStorage.getItem("api_key"),
  );
  return isLoggedIn ? (
    <Dashboard />
  ) : (
    <Login onLogin={() => setIsLoggedIn(true)} />
  );
}
