import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LogtoProvider, type LogtoConfig } from '@logto/react';
import App from './App';
import { Callback } from './auth/Callback';
import { ProtectedRoute } from './auth/ProtectedRoute';
import './index.css';

const logtoConfig: LogtoConfig = {
  endpoint: 'https://logto.dr.restry.cn',
  appId: '8bbiayv3m7sg8uetkbu5h',
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <LogtoProvider config={logtoConfig}>
        <Routes>
          <Route path="/callback" element={<Callback />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <App />
              </ProtectedRoute>
            }
          />
        </Routes>
      </LogtoProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
