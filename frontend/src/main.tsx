import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import jaJP from 'antd/locale/ja_JP'
import App from './App'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={jaJP}
      theme={{
        token: {
          colorPrimary: '#1F4E79',
          colorLink: '#2E75B6',
          borderRadius: 4,
          fontFamily: "'Yu Gothic UI', '游ゴシック', 'Meiryo', sans-serif",
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>
)
