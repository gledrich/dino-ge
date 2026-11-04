import React, { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { playgroundLogs, type LogLevel } from '../utils/LogManager';
import '../styles/console.css';

const Console: React.FC = () => {
  const logs = useSyncExternalStore(playgroundLogs.subscribe, playgroundLogs.getSnapshot);
  const [filter, setFilter] = useState<LogLevel | 'all'>('all');
  const consoleTextRef = useRef<HTMLDivElement>(null);
  
  const visibleLogs = filter === 'all' ? logs : logs.filter(log => log.level === filter);

  useEffect(() => {
    if (consoleTextRef.current) {
      consoleTextRef.current.scrollTop = consoleTextRef.current.scrollHeight;
    }
  }, [logs, filter]);

  const clearConsole = () => {
    playgroundLogs.clear();
  };

  const handleFilterChange = (newFilter: LogLevel | 'all') => {
    setFilter(newFilter);
  };

  return (
    <div className="console">
      <div className="console-header">
        <div className="header-left">
          <b className="title">Console</b>
          <div className="filter-chips">
            {(['all', 'log', 'info', 'warn', 'error'] as const).map((f) => (
              <span 
                key={f} 
                className={`filter-chip ${filter === f ? 'active' : ''} ${f}`}
                onClick={() => handleFilterChange(f)}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
        <i 
          className="fa-solid fa-trash-can clear-btn" 
          title="Clear Console"
          onClick={clearConsole}
        />
      </div>
      <div className="console-text" ref={consoleTextRef}>
        {visibleLogs.map((log) => (
          <div key={log.id} className={`console-line ${log.level}`}>
            <span className="bash">$</span>
            <pre>{log.message}</pre>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Console;
