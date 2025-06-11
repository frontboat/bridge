import { useProgress } from '../providers/progress-provider';

const statusIcons = {
  pending: '⏳',
  'in-progress': '🔄',
  completed: '✅',
  error: '❌'
};



function formatDuration(startTime?: number, endTime?: number): string {
  if (!startTime) return '';
  const end = endTime || Date.now();
  const duration = Math.round((end - startTime) / 1000);
  return `${duration}s`;
}

export function ProgressDisplay() {
  const { isActive, steps } = useProgress();

  if (!isActive && steps.length === 0) {
    return null;
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      border: '1px solid #333',
      borderRadius: '4px',
      padding: '1rem',
      margin: '1rem 0',
      backgroundColor: '#111',
      width: '100%',
      maxWidth: '100%',
      boxSizing: 'border-box',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        marginBottom: '1rem',
        fontSize: '0.9rem',
        color: '#fff',
        borderBottom: '1px solid #333',
        paddingBottom: '0.75rem',
        width: '100%'
      }}>
        <span style={{ 
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: '0.5rem', 
          fontSize: '14px' 
        }}>
          {isActive ? '🔄' : '✅'}
        </span>
        <span style={{ flex: '0 0 auto' }}>Resource Fetch Progress</span>
        {isActive && (
          <span style={{ 
            marginLeft: '0.5rem', 
            color: '#666', 
            fontSize: '0.8rem',
            flex: '0 0 auto'
          }}>
            Fetching...
          </span>
        )}
      </div>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%'
      }}>
        {steps.map((step, index) => (
          <div key={step.id} style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '0.5rem 0',
            borderBottom: index < steps.length - 1 ? '1px solid #333' : 'none',
            width: '100%'
          }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'flex-start', 
              gap: '0.75rem', 
              flex: '1 1 auto',
              minWidth: 0
            }}>
              <div style={{
                width: '18px',
                height: '18px',
                minWidth: '18px',
                minHeight: '18px',
                borderRadius: '4px',
                backgroundColor: step.status === 'completed' ? '#fff' : step.status === 'error' ? '#ff4444' : '#333',
                color: step.status === 'completed' ? '#000' : '#fff',
                fontSize: '0.6rem',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                {index + 1}
              </div>
              <span style={{ 
                fontSize: '12px', 
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center'
              }}>
                {statusIcons[step.status]}
              </span>
              <div style={{ 
                display: 'flex',
                flexDirection: 'column',
                flex: '1 1 auto', 
                minWidth: 0 
              }}>
                <div style={{ 
                  fontSize: '0.85rem', 
                  color: '#fff', 
                  fontWeight: '400',
                  wordBreak: 'break-word'
                }}>
                  {step.name}
                </div>
                {step.detail && (
                  <div style={{
                    fontSize: '0.75rem',
                    color: step.status === 'error' ? '#ff6666' : '#999',
                    marginTop: '0.25rem',
                    wordBreak: 'break-word'
                  }}>
                    {step.detail}
                  </div>
                )}
                {step.subSteps && step.subSteps.length > 0 && (
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    fontSize: '0.75rem',
                    color: '#666',
                    marginTop: '0.25rem'
                  }}>
                    <span>Balance Checks: {step.subSteps.filter(s => s.status === 'completed').length}/{step.subSteps.length}</span>
                    {step.subSteps.filter(s => s.detail?.includes('Found balance')).length > 0 && (
                      <span style={{ 
                        color: '#fff', 
                        marginLeft: '0.5rem',
                        display: 'flex',
                        alignItems: 'center'
                      }}>
                        • {step.subSteps.filter(s => s.detail?.includes('Found balance')).length} with funds
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              flexShrink: 0,
              marginLeft: '1rem'
            }}>
              <span style={{ 
                fontSize: '0.75rem', 
                color: '#666',
                whiteSpace: 'nowrap'
              }}>
                {formatDuration(step.startTime, step.endTime)}
              </span>
              <span style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.25rem 0.5rem',
                borderRadius: '4px',
                border: '1px solid #333',
                color: step.status === 'completed' ? '#fff' : step.status === 'error' ? '#ff6666' : '#999',
                fontSize: '0.6rem',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap'
              }}>
                {step.status.replace('-', ' ')}
              </span>
            </div>
          </div>
        ))}
      </div>

      {!isActive && steps.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: '0.75rem',
          padding: '0.75rem',
          backgroundColor: '#0a0a0a',
          border: '1px solid #fff',
          borderRadius: '4px',
          fontSize: '0.8rem',
          color: '#fff',
          width: '100%'
        }}>
          ✅ Completed successfully
        </div>
      )}
    </div>
  );
} 