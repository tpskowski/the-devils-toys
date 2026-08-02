import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const inlineElements = ["p", "strong", "em", "del", "code", "a", "br"];

/** Render authored Markdown without allowing block markup to reshape compact UI. */
export function InlineMarkdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <span className={`inline-markdown${className ? ` ${className}` : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        allowedElements={inlineElements}
        unwrapDisallowed
        components={{
          p: ({ node: _node, children: content }) => <>{content}</>,
          a: ({ node: _node, children: content, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {content}
            </a>
          )
        }}
      >
        {children}
      </ReactMarkdown>
    </span>
  );
}
