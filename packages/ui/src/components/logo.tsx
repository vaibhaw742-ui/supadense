import { ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-logo-mark-shadow" d="M12 16H4V8H12V16Z" fill="var(--icon-weak-base)" />
      <path data-slot="logo-logo-mark-o" d="M12 4H4V16H12V4ZM16 20H0V0H16V20Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M60 80H20V40H60V80Z" fill="var(--icon-base)" />
      <path d="M60 20H20V80H60V20ZM80 100H0V0H80V100Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 264 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g>
        {/* s */}
        <path d="M0 24H12V30H0Z" fill="var(--icon-weak-base)" />
        <path d="M0 6H24V12H0ZM0 12H12V18H0ZM0 18H24V24H0ZM12 24H24V30H12ZM0 30H24V36H0Z" fill="var(--icon-base)" />
        {/* u */}
        <path d="M48 30H36V18H48V30Z" fill="var(--icon-weak-base)" />
        <path d="M48 6H36V30H48V6ZM54 36H30V6H54V36Z" fill="var(--icon-base)" />
        {/* p */}
        <path d="M78 30H66V18H78V30Z" fill="var(--icon-weak-base)" />
        <path d="M66 30H78V12H66V30ZM84 36H66V42H60V6H84V36Z" fill="var(--icon-base)" />
        {/* a */}
        <path d="M90 24H108V30H90Z" fill="var(--icon-weak-base)" />
        <path d="M108 12H96V18H108V12ZM108 24H90V30H108V24ZM114 36H90V6H114V36Z" fill="var(--icon-base)" />
        {/* d */}
        <path d="M138 30H126V18H138V30Z" fill="var(--icon-weak-base)" />
        <path d="M138 12H126V30H138V12ZM144 36H120V6H138V0H144V36Z" fill="var(--icon-strong-base)" />
        {/* e */}
        <path d="M174 24V30H156V24H174Z" fill="var(--icon-weak-base)" />
        <path d="M174 24H156V30H174V36H150V6H174V24ZM156 18H168V12H156V18Z" fill="var(--icon-strong-base)" />
        {/* n */}
        <path d="M198 36H186V18H198V36Z" fill="var(--icon-weak-base)" />
        <path d="M198 12H186V36H180V6H198V12ZM204 36H198V12H204V36Z" fill="var(--icon-strong-base)" />
        {/* s */}
        <path d="M210 24H222V30H210Z" fill="var(--icon-weak-base)" />
        <path d="M210 6H234V12H210ZM210 12H222V18H210ZM210 18H234V24H210ZM222 24H234V30H222ZM210 30H234V36H210Z" fill="var(--icon-strong-base)" />
        {/* e */}
        <path d="M264 24V30H246V24H264Z" fill="var(--icon-weak-base)" />
        <path d="M264 24H246V30H264V36H240V6H264V24ZM246 18H258V12H246V18Z" fill="var(--icon-strong-base)" />
      </g>
    </svg>
  )
}
