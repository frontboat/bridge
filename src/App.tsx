import './App.css'
import { useConnect } from "@starknet-react/core"
import { BridgeOut } from './components/bridge'
import { useAuth } from './providers/auth-provider'

function ConnectWallet() {
  const { connectors, connect } = useConnect();

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      flex: 1,
      padding: '2rem',
      boxSizing: 'border-box'
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2rem',
        padding: '3rem',
        backgroundColor: '#111',
        border: '1px solid #333',
        borderRadius: '4px',
        maxWidth: '400px',
        width: '100%',
        boxSizing: 'border-box'
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <h1 style={{
            fontSize: '1.5rem',
            fontWeight: '400',
            color: '#fff',
            margin: 0,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
          }}>
            Connect Wallet
          </h1>
          <p style={{
            fontSize: '0.9rem',
            color: '#666',
            margin: 0,
            textAlign: 'center'
          }}>
            Connect your wallet to bridge resources
          </p>
        </div>
        
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          width: '100%'
        }}>
          {connectors.map((connector) => (
            <button
              key={connector.id}
              onClick={() => connect({ connector })}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.75rem 1.5rem',
                backgroundColor: 'transparent',
                color: '#fff',
                border: '1px solid #333',
                borderRadius: '4px',
                fontSize: '0.9rem',
                fontWeight: '400',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                width: '100%'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#fff';
                e.currentTarget.style.color = '#000';
                e.currentTarget.style.borderColor = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#fff';
                e.currentTarget.style.borderColor = '#333';
              }}
            >
              {connector.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function App() {
  const { isAuthenticated } = useAuth();

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
      minHeight: '100vh',
      backgroundColor: '#000',
      position: 'relative'
    }}>
      <h1 style={{
        fontSize: '2rem',
        fontWeight: '400',
        color: '#fff',
        margin: '2rem 0',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        letterSpacing: '0.05em',
        position: 'absolute',
        top: 0
      }}>
        RESOURCE BRIDGE
      </h1>
      
      {isAuthenticated ? <BridgeOut /> : <ConnectWallet />}
      
      <div style={{
        position: 'absolute',
        bottom: '2rem',
        fontSize: '0.8rem',
        color: '#666',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        made by{' '}
        <a 
          href="https://x.com/frontboat" 
          target="_blank" 
          rel="noopener noreferrer"
          style={{
            color: '#fff',
            textDecoration: 'none',
            borderBottom: '1px solid #333',
            transition: 'border-color 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#fff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#333';
          }}
        >
          frontboat
        </a>
      </div>
    </div>
  )
}

export default App
