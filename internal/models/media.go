package models

type MediaInfo struct {
	Duration   *float64
	HasVideo   bool
	HasAudio   bool
	VideoCodec string
	AudioCodec string
	Resolution string
}
