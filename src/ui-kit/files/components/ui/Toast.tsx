import { toast as toastify, ToastContainer, type ToastOptions } from 'react-toastify';
// Bundle the toast styles here so they can never be forgotten — without this
// import, react-toastify renders unstyled. Kept inside the kit (not the app)
// so it stays part of the locked design system.
import 'react-toastify/dist/ReactToastify.css';

const defaults: ToastOptions = {
  position: 'bottom-right',
  autoClose: 4000,
  hideProgressBar: true,
  closeOnClick: true,
  pauseOnHover: true,
};

export const toast = {
  success: (msg: string, opts?: ToastOptions) => toastify.success(msg, { ...defaults, ...opts }),
  error:   (msg: string, opts?: ToastOptions) => toastify.error(msg, { ...defaults, ...opts }),
  info:    (msg: string, opts?: ToastOptions) => toastify.info(msg, { ...defaults, ...opts }),
  warning: (msg: string, opts?: ToastOptions) => toastify.warning(msg, { ...defaults, ...opts }),
  dismiss: () => toastify.dismiss(),
};

export { ToastContainer };
