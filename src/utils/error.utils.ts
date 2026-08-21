import { HttpException, HttpStatus, Logger } from '@nestjs/common';

export const logAndThrowError = (message: string, error: any): void => {
  Logger.error(`${message}: ${error?.message}`, error?.stack);

  const statusCode = error?.status || HttpStatus.INTERNAL_SERVER_ERROR;
  const errorMessage =
    error?.message || 'Something went wrong, please try again later.';
  const response: { statusCode: number; error: string; message: string } = {
    statusCode: statusCode,
    error: HttpStatus[statusCode] || 'Error',
    message: errorMessage,
  };

  if (statusCode === HttpStatus.NOT_FOUND) {
    response.error = 'Not Found';
  } else if (statusCode === HttpStatus.UNAUTHORIZED) {
    response.error = 'Unauthorized Access';
  } else if (statusCode === HttpStatus.BAD_REQUEST) {
    response.error = 'Bad Request';
  } else if (statusCode === HttpStatus.CONFLICT) {
    response.error = 'Conflict';
  } else if (statusCode === HttpStatus.INTERNAL_SERVER_ERROR) {
    response.error = 'Server Error';
  } else if (statusCode === HttpStatus.PAYLOAD_TOO_LARGE) {
    response.error = 'File Too Large';
    response.message =
      'The uploaded file is too large. Please try uploading a smaller file (maximum 200MB per file).';
  }

  throw new HttpException(response, statusCode);
};
