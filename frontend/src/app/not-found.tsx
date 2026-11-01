import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{
      minHeight: '70vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
      textAlign: 'center',
    }}>
      <h1 style={{
        fontFamily: 'Georgia, serif',
        fontSize: '36px',
        fontWeight: 500,
        color: '#242b24',
        marginBottom: '12px',
      }}>
        Page not found
      </h1>
      <p style={{
        fontSize: '15px',
        color: '#6c7365',
        maxWidth: '460px',
        marginBottom: '28px',
        lineHeight: 1.5,
      }}>
        We could not find the page you are looking for. It may have moved or no longer exists.
      </p>
      <Link
        href="/"
        style={{
          background: '#344b36',
          color: '#f7f6f2',
          padding: '10px 20px',
          borderRadius: '6px',
          fontSize: '13px',
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        Back to catalog
      </Link>
    </div>
  );
}
