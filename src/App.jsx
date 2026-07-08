import React from "react";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "./contexts/ThemeContext.jsx";
import { AuthProvider } from "./contexts/AuthContext.jsx";
import { FeatureFlagsProvider } from "./contexts/FeatureFlagsContext.jsx";
import { ErrorBoundary } from "./components/common/ErrorBoundary.jsx";
import AppRouter from "./router/AppRouter.jsx";

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <FeatureFlagsProvider>
            <BrowserRouter basename={import.meta.env.BASE_URL}>
              <AppRouter />
            </BrowserRouter>
          </FeatureFlagsProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
